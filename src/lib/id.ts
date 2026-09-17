import { v4 as uuidv4 } from "uuid";

export function newId(): string {
  return uuidv4();
}

const DEVICE_ID_KEY = "shiori:deviceId";

export function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = uuidv4();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}
