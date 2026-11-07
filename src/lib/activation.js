export const initialActivation = () => ({ selected: {}, pending: {} });
export function foldActivation(state, event) {
  if (event.type === 'tool/call' && event.data.name === 'mcp_tools_load') {
    const pending = { ...state.pending, [event.data.callId]: true };
    for (const id of Object.keys(pending).slice(0, -128)) delete pending[id];
    return { ...state, pending };
  }
  if (event.type !== 'tool/result') return state;
  const message = event.data.message;
  const id = message?.toolCallId;
  if (typeof id !== 'string' || !Object.hasOwn(state.pending, id)) return state;
  const pending = { ...state.pending }; delete pending[id];
  const base = { ...state, pending };
  if (message.isError || event.data.error) return base;
  const text = message.content?.filter(x => x.type === 'text').map(x => x.text).join('') ?? '';
  let value; try { value = JSON.parse(text); } catch { return base; }
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1 || !Array.isArray(value.activated) || value.activated.length > 8) return base;
  const selected = { ...state.selected };
  for (const item of value.activated) {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || typeof item.hash !== 'string'
      || item.id.length > 64 || !/^mcp__[A-Za-z0-9_-]+$/.test(item.id) || !/^[a-f0-9]{64}$/.test(item.hash)) return base;
    if (!Object.hasOwn(selected, item.id) && Object.keys(selected).length >= 64) return base;
    selected[item.id] = item.hash;
  }
  return { selected, pending };
}
