export function openMessagesList(event: { preventDefault(): void; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; button: number }, href: string) {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
  const path = window.location.pathname;
  if (path !== href && !path.startsWith(`${href}/`)) return;
  event.preventDefault();
  window.dispatchEvent(new Event("care-chat:close"));
}
