/** 中国标准时间不受浏览器或服务器本地时区影响。 */
const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
});
const clockFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});

function parts(formatter, now) {
  return Object.fromEntries(formatter.formatToParts(now).map(({ type, value }) => [type, value]));
}

export function chinaDate(now = new Date()) {
  const { year, month, day } = parts(dateFormatter, now);
  return `${year}-${month}-${day}`;
}

export function chinaClock(now = new Date()) {
  const { hour, minute } = parts(clockFormatter, now);
  return `${hour}:${minute}`;
}
