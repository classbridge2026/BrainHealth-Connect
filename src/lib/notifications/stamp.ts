export function noticeStamp(unread: number, ids: readonly string[]) {
  return `${unread}:${ids.join(",")}`;
}

/** Ring only after a later check finds more unread notices than the last known count. */
export function noticeShouldRing(previousUnread: number | null, nextUnread: number) {
  if (previousUnread == null || nextUnread <= previousUnread) return false;
  return true;
}
