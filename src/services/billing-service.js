import { API_ENDPOINTS } from "../config/api-config.js";
import { requestJson } from "./http-client.js";

export function getBalance() {
  return requestJson(API_ENDPOINTS.billing.balance);
}
