export function parseMeetingChatPath(value = '') {
  const uuid = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
  const match = new RegExp('^meeting-(' + uuid + ')-(' + uuid + ')$').exec(value);
  return match ? { meetingId: match[1], chatId: match[2] } : null;
}
