window.__ModuleLoader__.load({
  id: '@pnpwin/dsh-lazy-discovery',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useRef, useSyncExternalStore, useId } = React;
    const namespace = 'pnpwin-lazy-mcp-auth';
    const texts = {
      en: {
        title: 'MCP authorization', subtitle: 'Connect configured MCP servers to named credentials. Secret values never enter this page.',
        scope: 'Configure the endpoint or executable in the MCP configuration, not here. Enabling bindings authorizes that destination to receive the selected credentials when connecting. No global environment is changed.',
        refresh: 'Refresh / retry', loading: 'Loading…', empty: 'No configured MCP servers.', save: 'Save bindings', saving: 'Saving…', saved: 'Saved and configuration reloaded.',
        enabled: 'Enable MCP server', destination: 'Destination (read-only)', mode: 'HTTP authorization', keep: 'Keep existing / no token bindings', bearer: 'Bearer token', custom: 'Custom headers',
        keepHint: 'Saves no additional named HTTP bindings. Existing literal credentials are not removed.', modeHint: 'Changing this mode replaces the HTTP mapping draft. Imported mappings are preserved until you edit them or change mode.',
        header: 'Header', env: 'Environment variable', ref: 'Credential name', prefix: 'Public prefix (optional)', add: 'Add mapping', remove: 'Remove mapping',
        nameHint: 'Credential and environment names: letters, digits and underscores; start with a letter or underscore, at most 128 characters. Reserved: DSH_*, __proto__, prototype, constructor. Headers use HTTP token names, excluding Host. Maximum 32 mappings in total.',
        prefixHint: 'Prefix is public text, at most 256 characters, for example “Bearer ”, including the trailing space. Never enter a key or secret value here.',
        literal: 'This server already has literal header or environment values. Keeping existing / no token bindings does not remove them. Only overlapping values are removed when you explicitly confirm replacement.',
        replace: 'Replace overlapping existing header or environment values with the selected named bindings.',
        targetChanged: 'The configured endpoint or executable changed after authorization. Existing named bindings are blocked until you review this server and destination and confirm a fresh authorization.',
        confirm: 'I authorize this server and destination to receive the selected named credentials:',
        ready: 'Configured', missing: 'Not configured', unknown: 'Not listed; checked on save',
        vaultUnavailable: 'Vault name suggestions are unavailable. Enter credential names manually; named credentials can come from the native provider without Vault.',
        vaultError: 'Could not refresh Vault name suggestions. Manual name entry is still available.',
        providerUnavailable: 'The credentials provider is unavailable. Enabled bindings cannot be saved until it is available.',
        readOnly: 'MCP configuration is read-only. Editing bindings is unavailable.',
        restart: 'Saving configuration may briefly restart the backend. If an operation fails, refresh / retry to verify the current state before saving again.',
        'error.request-too-large': 'The configuration request is too large (maximum 32 KiB). Reduce the mappings and retry.',
        'error.invalid-request': 'The request or server response is invalid. Refresh and retry.',
        'error.invalid-bindings': 'Check mapping names, duplicate targets, prefixes and the 32-mapping limit.',
        'error.invalid-name': 'Invalid credential name. Use a POSIX identifier, at most 128 characters, without DSH_*.',
        'error.config-read-only': 'MCP configuration is read-only.',
        'error.config-changed': 'Configuration changed elsewhere. Refresh, review the current bindings and confirm again.',
        'error.config-not-applied': 'Save is not confirmed: the fetched configuration differs from the requested bindings or destination. Verify / refresh, review the current settings and confirm again.',
        verify: 'Verify / refresh (read-only)', verifying: 'Checking saved bindings…',
        'error.dynamic-config': 'This configuration is generated dynamically and cannot be edited here.',
        'error.confirmation-required': 'Confirm that this server and destination may receive the selected named credentials.',
        'error.literal-conflict': 'A named binding overlaps existing literal credentials. Review and explicitly confirm replacement below.',
        'error.credential-provider-unavailable': 'The credentials provider is unavailable. Check plugin status and retry.',
        'error.credential-missing': 'A selected credential is not configured. Add its value in Tokens and environment or your native credential provider, then refresh.',
        'error.operation-failed': 'The operation failed. Nothing is confirmed saved. Refresh / retry to verify the current configuration.',
        'error.transport': 'Cannot reach the backend, or it restarted while saving. Nothing is confirmed saved. Refresh / retry to verify the current configuration.',
        'error.access-denied': 'Backend access denied (HTTP 401/403). Check access to this Harness page. Nothing is confirmed saved.',
        'error.route-unavailable': 'Authorization route unavailable (HTTP 404). Check that the updated Lazy Discovery Host plugin is active, then refresh. Nothing is confirmed saved.',
        'error.backend-response': 'The backend returned an unexpected HTTP or non-JSON response. Check the Host plugin and connection bridge, then refresh / retry. Nothing is confirmed saved.',
        'error.timeout': 'The backend request timed out. It may have restarted. Nothing is confirmed saved. Refresh / retry to verify the current configuration.',
      },
      ru: {
        title: 'Авторизация MCP', subtitle: 'Именованные credentials для настроенных MCP-серверов. Значения секретов никогда не загружаются на эту страницу.',
        scope: 'Адрес или исполняемый файл меняется в конфигурации MCP, не здесь. Включение привязок разрешает передавать выбранные credentials указанному получателю при подключении. Глобальное окружение не меняется.',
        refresh: 'Обновить / повторить', loading: 'Загрузка…', empty: 'Настроенных MCP-серверов нет.', save: 'Сохранить привязки', saving: 'Сохранение…', saved: 'Сохранено, конфигурация перечитана.',
        enabled: 'Включить MCP-сервер', destination: 'Получатель (только чтение)', mode: 'Авторизация HTTP', keep: 'Оставить существующее / без привязок токенов', bearer: 'Bearer-токен', custom: 'Произвольные заголовки',
        keepHint: 'Сохраняется без дополнительных именованных HTTP-привязок. Существующие credentials, заданные напрямую, не удаляются.', modeHint: 'Смена режима заменяет черновик HTTP-привязок. Импортированные привязки сохраняются, пока вы не измените их или режим.',
        header: 'Заголовок', env: 'Переменная окружения', ref: 'Имя credential', prefix: 'Открытый префикс (необязательно)', add: 'Добавить привязку', remove: 'Удалить привязку',
        nameHint: 'Имена credentials и переменных: буквы, цифры, подчёркивания; первый символ — буква или подчёркивание, до 128 символов. Зарезервированы DSH_*, __proto__, prototype, constructor. Заголовки — HTTP token, кроме Host. Всего до 32 привязок.',
        prefixHint: 'Префикс — открытый текст до 256 символов, например «Bearer » с пробелом в конце. Не вводите здесь ключи или значения секретов.',
        literal: 'У сервера уже есть значения заголовков или окружения, заданные напрямую. Режим без привязок токенов их не удаляет. Только пересекающиеся значения будут удалены после явного подтверждения замены.',
        replace: 'Заменить пересекающиеся значения заголовков или окружения выбранными именованными привязками.',
        targetChanged: 'Адрес или исполняемый файл изменён после авторизации. Именованные привязки заблокированы, пока вы не проверите сервер и получателя и не подтвердите авторизацию заново.',
        confirm: 'Я разрешаю передавать выбранные именованные credentials этому серверу и получателю:',
        ready: 'Настроено', missing: 'Нет значения', unknown: 'Нет в списке; проверяется при сохранении',
        vaultUnavailable: 'Подсказки имён Vault недоступны. Вводите имена вручную: штатный провайдер credentials работает и без Vault.',
        vaultError: 'Не удалось обновить подсказки имён Vault. Ручной ввод имён по-прежнему доступен.',
        providerUnavailable: 'Провайдер credentials недоступен. Сохранить включённые привязки можно после его восстановления.',
        readOnly: 'Конфигурация MCP доступна только для чтения. Редактирование привязок недоступно.',
        restart: 'Сохранение конфигурации может ненадолго перезапустить backend. При ошибке обновите данные и проверьте текущее состояние перед повторным сохранением.',
        'error.request-too-large': 'Запрос конфигурации слишком большой (не более 32 КиБ). Уменьшите число привязок и повторите.',
        'error.invalid-request': 'Некорректный запрос или ответ сервера. Обновите данные и повторите.',
        'error.invalid-bindings': 'Проверьте имена, повторяющиеся назначения, префиксы и ограничение в 32 привязки.',
        'error.invalid-name': 'Некорректное имя credential. Используйте POSIX-имя до 128 символов без DSH_*.',
        'error.config-read-only': 'Конфигурация MCP доступна только для чтения.',
        'error.config-changed': 'Конфигурация изменена извне. Обновите данные, проверьте привязки и подтвердите снова.',
        'error.config-not-applied': 'Сохранение не подтверждено: полученная конфигурация отличается от выбранных привязок или получателя. Проверьте / обновите данные, просмотрите настройки и подтвердите снова.',
        verify: 'Проверить / обновить (только чтение)', verifying: 'Проверка сохранённых привязок…',
        'error.dynamic-config': 'Эта конфигурация создаётся динамически и недоступна для редактирования здесь.',
        'error.confirmation-required': 'Подтвердите передачу выбранных именованных credentials этому серверу и получателю.',
        'error.literal-conflict': 'Именованная привязка пересекается с credential, заданным напрямую. Проверьте и явно подтвердите замену ниже.',
        'error.credential-provider-unavailable': 'Провайдер credentials недоступен. Проверьте статус плагинов и повторите.',
        'error.credential-missing': 'Выбранный credential не настроен. Добавьте значение в «Токены и окружение» или штатный провайдер credentials, затем обновите данные.',
        'error.operation-failed': 'Операция не выполнена. Сохранение не подтверждено. Обновите данные и проверьте текущую конфигурацию.',
        'error.transport': 'Нет связи с backend или он перезапущен во время сохранения. Сохранение не подтверждено. Обновите данные и проверьте текущую конфигурацию.',
        'error.access-denied': 'Backend отказал в доступе (HTTP 401/403). Проверьте доступ к этой странице Harness. Сохранение не подтверждено.',
        'error.route-unavailable': 'Маршрут авторизации недоступен (HTTP 404). Проверьте, что обновлённый Host-плагин Lazy Discovery активен, затем обновите данные. Сохранение не подтверждено.',
        'error.backend-response': 'Backend вернул неожиданный HTTP-ответ или ответ не в формате JSON. Проверьте Host-плагин и мост подключения, затем обновите данные и повторите. Сохранение не подтверждено.',
        'error.timeout': 'Превышено время ожидания ответа backend. Возможно, он перезапущен. Сохранение не подтверждено. Обновите данные и проверьте текущую конфигурацию.',
      },
    };
    const css = `
      .lma{font:inherit;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);padding:24px clamp(16px,4vw,40px);height:100%;overflow:auto;background:var(--dsw-alias-bg-base);box-sizing:border-box}
      .lma *{box-sizing:border-box}.lma-inner{max-width:840px;margin:auto}.lma h2{font-size:20px;line-height:28px;margin:0;font-weight:600}.lma h3{font-size:14px;margin:0;font-weight:600;overflow-wrap:anywhere}.lma p{margin:8px 0 12px}.lma-muted,.lma small{color:var(--dsw-alias-label-secondary)}.lma small{display:block;font-size:12px;line-height:18px}.lma-card{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:16px;margin-top:16px}.lma-head,.lma-actions{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.lma-actions{justify-content:flex-start;align-items:center;flex-wrap:wrap}.lma-destination{overflow-wrap:anywhere}.lma label{display:block;margin:12px 0}.lma-check{display:flex!important;gap:8px;align-items:flex-start}.lma-check input{margin-top:4px;flex-shrink:0}.lma button,.lma input,.lma select{font:inherit}.lma button{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:6px 10px;cursor:pointer}.lma button:hover{background:var(--dsw-alias-bg-layer-1)}.lma button:disabled{cursor:default;opacity:.5}.lma input:not([type=checkbox]),.lma select{display:block;width:100%;padding:8px 10px;border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);margin:6px 0}.lma button:focus-visible,.lma input:focus-visible,.lma select:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.lma-mapping{display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:10px;align-items:start;padding:10px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}.lma-mapping label{margin:0;min-width:0}.lma-mapping button{margin-top:26px}.lma-env{grid-template-columns:1fr 1fr auto}.lma-warning{padding:12px;background:var(--dsw-alias-bg-layer-1);border-radius:8px}.lma-error{color:var(--dsw-alias-state-error-primary)}.lma-success{color:var(--dsw-alias-state-success-primary);display:flex;align-items:center;gap:10px;padding:8px 12px;border:1px solid var(--dsw-alias-state-success-primary);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}.lma-success strong{display:block;font-weight:600}.lma-success-icon{font-size:20px;line-height:24px;flex-shrink:0}.lma-confirm{margin-top:16px}.lma fieldset{padding:0;border:0;min-width:0;margin:0}.lma code{overflow-wrap:anywhere}.lma-status{font-size:12px;color:var(--dsw-alias-label-secondary)}
      @media(max-width:640px){.lma{padding:16px}.lma-head{flex-direction:column}.lma-mapping,.lma-env{grid-template-columns:1fr}.lma-mapping button{margin-top:0;justify-self:start}.lma-card{padding:14px}}
    `;
    const identifier = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
    const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
    const validRef = name => typeof name === 'string' && identifier.test(name) && !name.startsWith('DSH_') && !forbidden.has(name);
    const headerName = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
    function errorCode(error) {
      const code = error?.message;
      return Object.hasOwn(texts.en, `error.${code}`) ? code : 'transport';
    }
    function initialMode(server) {
      const entries = Object.entries(server.headerRefs);
      return !entries.length ? 'keep' : entries.length === 1 && entries[0][0] === 'Authorization' && entries[0][1].prefix === 'Bearer ' ? 'bearer' : 'custom';
    }
    function headerRows(refs) {
      return Object.entries(refs).map(([target, ref]) => ({ target, name: ref.name, prefix: ref.prefix ?? '', hasPrefix: Object.hasOwn(ref, 'prefix') }));
    }
    function validateBindings(headerRefs, envRefs) {
      const headers = Object.entries(headerRefs), env = Object.entries(envRefs);
      if (headers.length + env.length > 32) return 'invalid-bindings';
      const seen = new Set();
      for (const [target, binding] of headers) {
        if (!headerName.test(target) || target.toLowerCase() === 'host' || forbidden.has(target) || seen.has(target.toLowerCase()) || (binding.prefix ?? '').length > 256 || /[\r\n\0]/.test(binding.prefix ?? '')) return 'invalid-bindings';
        seen.add(target.toLowerCase());
      }
      if (env.some(([target]) => !validRef(target))) return 'invalid-bindings';
      for (const name of [...headers.map(([, ref]) => ref.name), ...env.map(([, name]) => name)]) {
        if (!validRef(name)) return 'invalid-name';
      }
      return '';
    }
    function validSnapshot(data) {
      const map = value => value !== null && typeof value === 'object' && !Array.isArray(value);
      return data?.version === 1 && typeof data.writable === 'boolean' && typeof data.credentialProviderAvailable === 'boolean' && Array.isArray(data.servers) && data.servers.every(server =>
        map(server) && typeof server.serverName === 'string' && typeof server.destination === 'string' && typeof server.revision === 'string' && ['streamable-http', 'stdio'].includes(server.transport) && typeof server.enabled === 'boolean' && typeof server.hasLiteralCredentials === 'boolean' &&
        (server.editable === undefined || typeof server.editable === 'boolean') && (server.bindingTargetChanged === undefined || typeof server.bindingTargetChanged === 'boolean') &&
        map(server.headerRefs) && Object.values(server.headerRefs).every(ref => map(ref) && typeof ref.name === 'string' && (ref.prefix === undefined || typeof ref.prefix === 'string')) &&
        map(server.envRefs) && Object.values(server.envRefs).every(name => typeof name === 'string') &&
        Array.isArray(server.credentials) && server.credentials.every(ref => map(ref) && typeof ref.name === 'string' && typeof ref.configured === 'boolean'));
    }
    function matchesSaved(snapshot, expected) {
      const current = snapshot.servers.find(server => server.serverName === expected.serverName);
      if (!current || current.transport !== expected.transport || current.destination !== expected.destination || current.enabled !== expected.enabled || current.bindingTargetChanged) return false;
      const headers = refs => Object.entries(refs).map(([target, ref]) => [target, ref.name, ref.prefix ?? '']).sort(([a], [b]) => a.localeCompare(b));
      const environment = refs => Object.entries(refs).sort(([a], [b]) => a.localeCompare(b));
      return JSON.stringify(headers(current.headerRefs)) === JSON.stringify(headers(expected.headerRefs)) && JSON.stringify(environment(current.envRefs)) === JSON.stringify(environment(expected.envRefs));
    }
    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        for (const [lang, dictionary] of Object.entries(texts)) ctx.effect(() => ctx.locale.register(namespace, lang, dictionary));
        const t = ctx.locale.bind(namespace);
        function useLocale() {
          useSyncExternalStore(listener => ctx.locale.subscribe(listener), () => ctx.locale.getSnapshot());
        }
        function ServerForm({ server, writable, providerAvailable, suggestions, busy, save, dirty, operation, verify }) {
          useLocale();
          const expected = operation?.expected;
          const initial = operation?.status !== 'saved' && expected?.serverName === server.serverName && expected.transport === server.transport && expected.destination === server.destination ? { ...server, ...expected } : server;
          const [enabled, setEnabled] = useState(initial.enabled);
          const [mode, setMode] = useState(() => initialMode(initial));
          const [headers, setHeaders] = useState(() => headerRows(initial.headerRefs));
          const [env, setEnv] = useState(() => Object.entries(initial.envRefs).map(([target, name]) => ({ target, name })));
          const [confirmed, setConfirmed] = useState(false), [replaceExisting, setReplaceExisting] = useState(false), [error, setError] = useState('');
          const listId = useId();
          const names = [...new Map([...server.credentials, ...suggestions].map(row => [row.name, row])).values()];
          const locked = busy || !writable || server.editable === false;
          function change(update) { update(); setConfirmed(false); setError(''); dirty(); }
          const http = server.transport === 'streamable-http';
          const headerRefs = http ? Object.fromEntries(headers.map(row => [row.target, { name: row.name, ...(row.hasPrefix ? { prefix: row.prefix } : {}) }])) : server.headerRefs;
          const envRefs = http ? server.envRefs : Object.fromEntries(env.map(row => [row.target, row.name]));
          const count = Object.keys(headerRefs).length + Object.keys(envRefs).length;
          const rowCount = http ? headers.length + Object.keys(server.envRefs).length : env.length + Object.keys(server.headerRefs).length;
          const duplicateRows = http ? new Set(headers.map(row => row.target.toLowerCase())).size !== headers.length : new Set(env.map(row => row.target)).size !== env.length;
          const validation = duplicateRows ? 'invalid-bindings' : validateBindings(headerRefs, envRefs);
          const needsConfirmation = enabled && count > 0;
          function status(name) {
            const credential = suggestions.find(row => row.name === name) ?? server.credentials.find(row => row.name === name);
            return t(credential ? credential.configured ? 'ready' : 'missing' : 'unknown');
          }
          function nameInput(row, update) {
            return h('label', null, t('ref'), h('input', { value: row.name, list: listId, autoComplete: 'off', spellCheck: false, maxLength: 128, required: true, placeholder: 'MCP_TOKEN', onChange: event => change(() => update({ ...row, name: event.target.value })) }), h('small', null, status(row.name)));
          }
          function acknowledgement(key, checked, update) {
            return h('label', { className: 'lma-check' }, h('input', { type: 'checkbox', checked, onChange: event => update(event.target.checked) }), h('span', null, t(key)));
          }
          return h('form', { className: 'lma-card', 'aria-label': server.serverName, onSubmit: async event => {
            event.preventDefault();
            if (locked) return;
            const code = validation || (needsConfirmation && !confirmed ? 'confirmation-required' : '');
            if (code) { setError(code); return; }
            setError('');
            await save({ serverName: server.serverName, revision: server.revision, enabled, headerRefs, envRefs, confirmed, replaceExisting });
          } },
          h('h3', null, server.serverName), h('div', { className: 'lma-status' }, server.transport),
          h('p', { className: 'lma-destination' }, t('destination'), ': ', h('code', null, server.destination)),
          writable && server.editable === false && h('p', { className: 'lma-warning' }, t('error.dynamic-config')),
          server.bindingTargetChanged && h('p', { className: 'lma-warning', role: 'alert' }, t('targetChanged')),
          h('fieldset', { disabled: locked },
            acknowledgement('enabled', enabled, value => change(() => setEnabled(value))),
            http && h('label', null, t('mode'), h('select', { value: mode, onChange: event => change(() => {
              const next = event.target.value;
              setMode(next);
              setHeaders(next === 'keep' ? [] : next === 'bearer' ? [{ target: 'Authorization', name: '', prefix: 'Bearer ', hasPrefix: true }] : [{ target: '', name: '', prefix: '', hasPrefix: false }]);
              setReplaceExisting(false);
            }) }, h('option', { value: 'keep' }, t('keep')), h('option', { value: 'bearer' }, t('bearer')), h('option', { value: 'custom' }, t('custom'))), h('small', null, t('modeHint'))),
            http && mode === 'keep' && h('p', { className: 'lma-muted' }, t('keepHint')),
            http ? headers.map((row, index) => h('div', { key: index, className: 'lma-mapping' },
              h('label', null, t('header'), h('input', { value: row.target, readOnly: mode === 'bearer', required: true, autoComplete: 'off', spellCheck: false, onChange: event => change(() => setHeaders(headers.map((item, i) => i === index ? { ...row, target: event.target.value } : item))) })),
              nameInput(row, next => setHeaders(headers.map((item, i) => i === index ? next : item))),
              h('label', null, t('prefix'), h('input', { value: row.prefix, readOnly: mode === 'bearer', maxLength: 256, autoComplete: 'off', spellCheck: false, onChange: event => change(() => setHeaders(headers.map((item, i) => i === index ? { ...row, prefix: event.target.value, hasPrefix: true } : item))) })),
              mode === 'custom' && h('button', { type: 'button', onClick: () => change(() => setHeaders(headers.filter((_, i) => i !== index))) }, t('remove')))) : env.map((row, index) => h('div', { key: index, className: 'lma-mapping lma-env' },
              h('label', null, t('env'), h('input', { value: row.target, required: true, maxLength: 128, autoComplete: 'off', spellCheck: false, placeholder: 'API_TOKEN', onChange: event => change(() => setEnv(env.map((item, i) => i === index ? { ...row, target: event.target.value } : item))) })),
              nameInput(row, next => setEnv(env.map((item, i) => i === index ? next : item))),
              h('button', { type: 'button', onClick: () => change(() => setEnv(env.filter((_, i) => i !== index))) }, t('remove')))),
            ((!http || mode === 'custom') && h('button', { type: 'button', disabled: rowCount >= 32, onClick: () => change(() => http ? setHeaders([...headers, { target: '', name: '', prefix: '', hasPrefix: false }]) : setEnv([...env, { target: '', name: '' }])) }, t('add'))),
            h('datalist', { id: listId }, names.map(row => h('option', { key: row.name, value: row.name }, t(row.configured ? 'ready' : 'missing')))),
            h('p', null, h('small', null, t('nameHint')), http && h('small', null, t('prefixHint'))),
            server.hasLiteralCredentials && h('div', { className: 'lma-warning' }, h('p', null, t('literal')), count > 0 && acknowledgement('replace', replaceExisting, value => change(() => setReplaceExisting(value)))),
            needsConfirmation && h('div', { className: 'lma-confirm' }, acknowledgement('confirm', confirmed, setConfirmed), h('code', null, server.serverName, ' → ', server.destination), h('ul', null, Object.entries(headerRefs).map(([target, binding]) => h('li', { key: `h:${target}` }, target, ' ← ', binding.name)), Object.entries(envRefs).map(([target, name]) => h('li', { key: `e:${target}` }, target, ' ← ', name)))),
          ),
          (error || validation) && h('p', { className: 'lma-error', role: 'alert' }, t(`error.${error || validation}`)),
          h('div', { className: 'lma-actions' }, h('button', { type: 'submit', disabled: locked || Boolean(validation) || needsConfirmation && (!confirmed || !providerAvailable) }, t(operation?.status === 'saving' ? 'saving' : 'save')),
            (operation?.status === 'saving' || operation?.status === 'verifying') && h('span', { role: 'status', 'aria-live': 'polite' }, t(operation.status === 'saving' ? 'saving' : 'verifying')),
            operation?.status === 'error' && h('div', { className: 'lma-error', role: 'alert' }, t(`error.${operation.error}`)),
            operation?.status === 'error' && h('button', { type: 'button', disabled: busy, onClick: verify }, t('verify')),
            operation?.status === 'saved' && h('div', { className: 'lma-success', role: 'status', 'aria-live': 'polite', 'aria-atomic': true }, h('span', { className: 'lma-success-icon', 'aria-hidden': true }, '✓'), h('div', null, h('strong', null, t('saved')), h('small', null, server.serverName)))),
          );
        }
        function Page() {
          useLocale();
          const [data, setData] = useState(null), [suggestions, setSuggestions] = useState([]), [vaultState, setVaultState] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [operations, setOperations] = useState({}), [generation, setGeneration] = useState(0);
          const alive = useRef(false), requests = useRef(new Set()), lock = useRef(false), lifecycle = useRef(0);
          async function request(url, body, optional = false) {
            const controller = new AbortController(); requests.current.add(controller);
            let timedOut = false;
            const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 20000);
            try {
              const response = await fetch(url, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal });
              if (optional && (response.status === 404 || response.status === 503)) return null;
              const statusCode = response.status === 401 || response.status === 403 ? 'access-denied' : response.status === 404 ? 'route-unavailable' : 'backend-response';
              let result;
              try { result = await response.json(); }
              catch { throw new Error(statusCode); }
              const code = result?.error?.code;
              if (typeof code === 'string' && Object.hasOwn(texts.en, `error.${code}`)) throw new Error(code);
              if (!response.ok || result?.error) throw new Error(statusCode);
              return result;
            } catch (caught) { throw new Error(timedOut ? 'timeout' : errorCode(caught)); }
            finally { clearTimeout(timer); requests.current.delete(controller); }
          }
          function publish(snapshot, reset = false) {
            setData(snapshot);
            if (reset) setGeneration(value => value + 1);
            setOperations(current => Object.fromEntries(Object.entries(current).map(([name, operation]) => [name, operation.status === 'saved' && !matchesSaved(snapshot, operation.expected) ? { ...operation, status: 'error', error: 'config-not-applied' } : operation])));
          }
          async function refresh({ apply = true, reset = false } = {}) {
            const epoch = lifecycle.current;
            const result = await request('/api/lazy-discovery/auth');
            if (!validSnapshot(result)) throw new Error('invalid-request');
            if (apply && alive.current && epoch === lifecycle.current) publish(result, reset);
            return result;
          }
          async function refreshSuggestions() {
            const epoch = lifecycle.current;
            try {
              const result = await request('/api/token-vault/list', undefined, true);
              if (!alive.current || epoch !== lifecycle.current) return;
              setSuggestions(Array.isArray(result?.entries) ? result.entries.filter(row => row && typeof row.name === 'string').map(({ name, configured }) => ({ name, configured: Boolean(configured) })) : []);
              setVaultState(result === null ? 'vaultUnavailable' : Array.isArray(result?.entries) ? '' : 'vaultError');
            } catch { if (alive.current && epoch === lifecycle.current) { setSuggestions([]); setVaultState('vaultError'); } }
          }
          async function perform(operation, serverName) {
            if (lock.current) return;
            const epoch = lifecycle.current;
            lock.current = true; setBusy(true); setError('');
            try { await operation(); }
            catch (caught) {
              if (alive.current && epoch === lifecycle.current) {
                if (serverName) setOperations(current => ({ ...current, [serverName]: { ...current[serverName], status: 'error', error: errorCode(caught) } }));
                else setError(errorCode(caught));
              }
            }
            finally { if (epoch === lifecycle.current) { lock.current = false; if (alive.current) setBusy(false); } }
          }
          function reload() { return perform(() => Promise.all([refresh({ reset: true }), refreshSuggestions()])); }
          useEffect(() => {
            alive.current = true;
            void reload();
            return () => { alive.current = false; lifecycle.current += 1; lock.current = false; for (const controller of requests.current) controller.abort(); requests.current.clear(); };
          }, []);
          async function save(body) {
            const epoch = lifecycle.current;
            await perform(async () => {
              const target = data?.servers.find(server => server.serverName === body.serverName);
              if (!target || typeof body.enabled !== 'boolean' || !body.headerRefs || !body.envRefs) throw new Error('invalid-request');
              const expected = { serverName: body.serverName, transport: target.transport, destination: target.destination, enabled: body.enabled, headerRefs: body.headerRefs, envRefs: body.envRefs };
              setOperations(current => ({ ...current, [body.serverName]: { status: 'saving', expected } }));
              const result = await request('/api/lazy-discovery/auth/save', body);
              if (result?.saved !== true || result.serverName !== body.serverName) throw new Error('operation-failed');
              if (!alive.current || epoch !== lifecycle.current) return;
              setOperations(current => ({ ...current, [body.serverName]: { status: 'verifying', expected } }));
              const saved = await refresh({ apply: false });
              if (!alive.current || epoch !== lifecycle.current) return;
              if (!matchesSaved(saved, expected)) throw new Error('config-not-applied');
              publish(saved);
              setOperations(current => ({ ...current, [body.serverName]: { status: 'saved', expected } }));
            }, body.serverName);
          }
          async function verify(serverName) {
            const expected = operations[serverName]?.expected;
            if (!expected) return;
            const epoch = lifecycle.current;
            await perform(async () => {
              setOperations(current => ({ ...current, [serverName]: { status: 'verifying', expected } }));
              const saved = await refresh({ reset: true });
              if (!alive.current || epoch !== lifecycle.current) return;
              if (!matchesSaved(saved, expected)) throw new Error('config-not-applied');
              setOperations(current => ({ ...current, [serverName]: { status: 'saved', expected } }));
            }, serverName);
          }
          return h('section', { className: 'lma', 'aria-label': t('title') }, h('style', null, css), h('div', { className: 'lma-inner' },
            h('div', { className: 'lma-head' }, h('div', null, h('h2', null, t('title')), h('p', { className: 'lma-muted' }, t('subtitle'))), h('button', { disabled: busy, onClick: reload }, t('refresh'))),
            h('p', { className: 'lma-muted' }, t('scope')), h('p', { className: 'lma-muted' }, t('restart')),
            error && h('p', { className: 'lma-error', role: 'alert' }, t(`error.${error}`)),
            data && !data.writable && h('p', { className: 'lma-warning', role: 'status' }, t('readOnly')),
            data && !data.credentialProviderAvailable && h('p', { className: 'lma-warning', role: 'status' }, t('providerUnavailable')),
            vaultState && h('p', { className: 'lma-muted', role: 'status' }, t(vaultState)),
            h('div', { 'aria-busy': busy }, !data ? !error && h('p', { role: 'status' }, t('loading')) : !data.servers.length ? h('p', null, t('empty')) : data.servers.map(server => h(ServerForm, { key: `${generation}:${server.serverName}:${server.transport}:${server.destination}`, server, writable: data.writable, providerAvailable: data.credentialProviderAvailable, suggestions, busy, save, operation: operations[server.serverName], verify: () => verify(server.serverName), dirty: () => { setOperations(current => { const next = { ...current }; delete next[server.serverName]; return next; }); setError(''); } }))),
          ));
        }
        ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'lazy-mcp-auth', order: 36, label: () => t('title') }, Page));
      },
    };
  },
});
