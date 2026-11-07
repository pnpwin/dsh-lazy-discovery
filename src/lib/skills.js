import { createHash } from 'node:crypto';
import { searchCatalog } from './search.js';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const aborted = signal => signal?.throwIfAborted();
const sameIdentity = (left, right) => left.length === right.length && left.every((value, i) => value === right[i]);

function waitFor(promise, signal) {
  aborted(signal);
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const cancel = () => reject(signal.reason ?? new Error('Skill discovery aborted'));
    signal.addEventListener('abort', cancel, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', cancel)).catch(() => {});
  });
}

// Never copy bodies, opaque locators, resource paths, arbitrary metadata or credentials.
function cardsOf(skills) {
  return skills.filter(skill => skill.invocation?.modelInvocable === true).map(skill => ({
    id: skill.name,
    name: skill.name,
    kind: 'skill',
    description: skill.description,
    ...(typeof skill.whenToUse === 'string' ? { whenToUse: skill.whenToUse } : {}),
    ...(typeof skill.provider === 'string' ? { provider: skill.provider } : {}),
  }));
}

/**
 * Metadata-only discovery, separate from the unmodified stock skill loader/gesture.
 * getScopeIdentity must return the current object-identity scope chain (scopeChainOf).
 * Without it, snapshots are deliberately not reused across separate requests.
 * isSkillVisible must check the exact stock registration, not merely its name.
 * Disk hints are read only after a fresh scoped snapshot validates their complete digest.
 */
export function createSkillsDiscovery({
  ctx,
  cache,
  search = searchCatalog,
  createUserMessage,
  getScopeIdentity,
  isSkillVisible,
  maxAgeMs = 60_000,
  maxChars = 5_000,
  now = Date.now,
}) {
  if (typeof isSkillVisible !== 'function') throw new TypeError('isSkillVisible must check the stock skill tool registration');
  if (typeof createUserMessage !== 'function') throw new TypeError('createUserMessage is required for durable catalog retirement');
  if (!Number.isFinite(maxAgeMs) || maxAgeMs < 0) throw new TypeError('maxAgeMs must be non-negative');
  let revision = 0;
  let disposed = false;
  let states = new WeakMap();
  const controllers = new Set();
  const installations = new Map();

  function invalidate() {
    revision++;
    states = new WeakMap();
    // A provider invalidation must not let an old in-flight observation become reusable.
    for (const controller of controllers) controller.abort(new Error('Skill catalog invalidated; retry discovery'));
    controllers.clear();
  }
  const stopChanges = ctx.on('skills/change', invalidate);

  function assertActive() {
    if (disposed) throw new Error('Skill discovery disposed');
  }
  function scopeIdentity(agent) {
    const value = getScopeIdentity?.(agent);
    if (!value) return [Symbol('uncached-scope')];
    return Array.isArray(value) ? value : [value];
  }
  function visible(agent) {
    return Boolean(isSkillVisible(agent));
  }

  async function snapshot(agent, signal) {
    assertActive();
    aborted(signal);
    const cwd = await ctx.workingDirectory.ensure(agent, signal);
    aborted(signal);
    if (!visible(agent)) return { entries: [], complete: true, hidden: true, cwd };
    const identity = scopeIdentity(agent);
    let state = states.get(agent);
    if (state && state.cwd === cwd && state.revision === revision && sameIdentity(state.identity, identity)) {
      if (state.pending) return waitFor(state.pending, signal);
      if (state.complete && now() - state.savedAt < maxAgeMs) return state;
    }
    const controller = new AbortController();
    controllers.add(controller);
    state = { cwd, identity, revision, complete: false, savedAt: 0, entries: [], controller };
    states.set(agent, state);
    const capturedRevision = revision;
    state.pending = (async () => {
      const observed = await ctx.skills.snapshot({ cwd, scope: agent, signal: controller.signal });
      aborted(controller.signal);
      assertActive();
      if (capturedRevision !== revision || !sameIdentity(identity, scopeIdentityForValidation(agent, identity))) {
        throw new Error('Skill scope changed during discovery; retry');
      }
      if (ctx.workingDirectory.get(agent.session) !== cwd) throw new Error('Working directory changed during skill discovery; retry');
      if (!visible(agent)) return { ...state, entries: [], complete: true, hidden: true };
      const entries = cardsOf(observed.skills);
      const value = { kind: 'skills', cwd, entries, complete: observed.complete === true };
      // Disk data never supplies authorization: current scoped discovery is authoritative.
      if (value.complete && cache) {
        const key = hash(value);
        try {
          await cache.read(key, { maxAgeMs, validate: candidate => hash(candidate) === key });
          await cache.write(key, value);
        } catch {
          // A cache is optional; a disk failure cannot erase an authorized live catalog.
        }
      }
      aborted(controller.signal);
      assertActive();
      if (capturedRevision !== revision || !sameIdentity(identity, scopeIdentityForValidation(agent, identity))
          || ctx.workingDirectory.get(agent.session) !== cwd || !visible(agent)) {
        throw new Error('Skill catalog or scope changed during discovery; retry');
      }
      Object.assign(state, value, { savedAt: now(), hidden: false });
      return state;
    })().finally(() => {
      controllers.delete(controller);
      state.pending = undefined;
    });
    // Cancellation of one waiter cannot poison a shared discovery for another caller.
    state.pending.catch(() => {});
    return waitFor(state.pending, signal);
  }

  function scopeIdentityForValidation(agent, fallback) {
    if (!getScopeIdentity) return fallback;
    return scopeIdentity(agent);
  }

  async function find(agent, query, { signal, limit = 5 } = {}) {
    const observation = await snapshot(agent, signal);
    aborted(signal);
    const result = await search(observation.entries, query, { limit, maxChars, kind: 'skill' });
    aborted(signal);
    assertActive();
    if (!observation.hidden && (observation.revision !== revision || !visible(agent)
        || ctx.workingDirectory.get(agent.session) !== observation.cwd
        || !sameIdentity(observation.identity, scopeIdentityForValidation(agent, observation.identity)))) {
      throw new Error('Skill catalog or scope changed during search; retry');
    }
    return { ...result, complete: observation.complete, hidden: observation.hidden === true };
  }

  // Read only the newest visible catalog. Old shadowed log entries cannot keep a
  // permanent "loaded" flag alive after compaction, resume or a fork.
  function needsRetirement(agent) {
    const session = agent.session;
    const nodes = session?.surface?.nodes ?? [];
    for (let index = nodes.length - 1; index >= 0; index--) {
      const event = session.eventAt(nodes[index]);
      if (event?.type !== 'user/message' || event.data.source?.kind !== 'skill-catalog') continue;
      const entries = event.data.source.entries;
      if (Array.isArray(entries)) return entries.length > 0;
    }
    return false;
  }

  function transformDecision(agent, decision) {
    assertActive();
    if (decision.kind !== 'enter') return decision;
    const messages = decision.messages.filter(message => message.source?.kind !== 'skill-catalog');
    if (needsRetirement(agent)) {
      messages.push(createUserMessage({
        source: { kind: 'skill-catalog', form: 'catalog', update: true, entries: [] },
        content: [{ type: 'text', text: 'Earlier skill catalogs are retired. Discover current skills with skill_search; then load the exact name with skill. Follow directly injected <skill_content> without loading it again.' }],
      }));
    }
    if (messages.length === decision.messages.length && messages.every((message, i) => message === decision.messages[i])) return decision;
    return { ...decision, messages };
  }

  function install(agent) {
    assertActive();
    const existing = installations.get(agent);
    if (existing) return existing;
    // Cordis 4.1 waterfall is outermost-first and prepend unshifts. Therefore
    // our post-next transform sees the shipped stock push listeners' output.
    // A later third-party prepend transformer can still override this policy.
    const stop = agent.ctx.effect(() => {
      const removeListener = agent.ctx.on('agent/pre-step', async ({ agent: proposed, signal }, next) => {
        const decision = await next();
        aborted(signal);
        return proposed === agent ? transformDecision(agent, decision) : decision;
      }, { prepend: true });
      return () => {
        removeListener();
        installations.delete(agent);
        states.get(agent)?.controller?.abort(new Error('Skill discovery agent disposed'));
        states.delete(agent);
      };
    });
    let stopped = false;
    const uninstall = () => {
      if (stopped) return;
      stopped = true;
      stop();
    };
    installations.set(agent, uninstall);
    return uninstall;
  }

  function status(agent) {
    const state = states.get(agent);
    const cwd = ctx.workingDirectory.get(agent.session);
    const identity = getScopeIdentity ? scopeIdentity(agent) : null;
    const reusable = !disposed && visible(agent) && state?.complete === true && state.revision === revision
      && state.cwd === cwd && identity && sameIdentity(state.identity, identity) && now() - state.savedAt < maxAgeMs;
    return { disposed, revision, cached: Boolean(reusable), count: reusable ? state.entries.length : 0,
      complete: reusable ? true : null, installed: installations.has(agent) };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    stopChanges();
    invalidate();
    for (const stop of [...installations.values()]) stop();
  }

  return { search: find, invalidate, status, dispose, install, transformDecision };
}
