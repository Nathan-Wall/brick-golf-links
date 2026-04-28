function getDateOrNow(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

export function getHourStart(value: string) {
  const date = getDateOrNow(value);
  date.setUTCMinutes(0, 0, 0);
  return date.toISOString();
}

export function getTenMinuteBucketStart(value: string) {
  const date = getDateOrNow(value);
  date.setUTCMinutes(Math.floor(date.getUTCMinutes() / 10) * 10, 0, 0);
  return date.toISOString();
}
