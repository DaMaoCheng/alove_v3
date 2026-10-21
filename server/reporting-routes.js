import { handleAdminReportingRoute } from "./admin-reporting-routes.js";
import { requireReportingToken } from "./reporting-token-service.js";
import { getReportingConversation, getReportingGuestConversation, listReportingAccounts, listReportingAccountConversations, listReportingGuests } from "./reporting-data-service.js";
import { sendJson } from "./http-utils.js";
export async function handleReportingRoute(req,res,{path,requestUrl}) {
  if (path.startsWith("/api/admin/reporting-tokens")) return handleAdminReportingRoute(req,res,{path,requestUrl});
  if (req.method!=="GET" || !path.startsWith("/api/reporting/")) return false;
  const guestDetail=path.match(/^\/api\/reporting\/guests\/([^/]+)\/conversations\/([^/]+)$/);
  if(guestDetail){const t=await requireReportingToken(req,["guests:read","conversations:read"]);sendJson(res,200,await getReportingGuestConversation(t,decode(guestDetail[1]),decode(guestDetail[2])));return true;}
  const accountDetail=path.match(/^\/api\/reporting\/accounts\/([^/]+)\/conversations\/([^/]+)$/);
  if(accountDetail){const t=await requireReportingToken(req,["accounts:read","conversations:read"]);sendJson(res,200,await getReportingConversation(t,requestUrl,decode(accountDetail[1]),decode(accountDetail[2])));return true;}
  const accountConv=path.match(/^\/api\/reporting\/accounts\/([^/]+)\/conversations$/);
  if(accountConv){const t=await requireReportingToken(req,["accounts:read","conversations:read"]);sendJson(res,200,await listReportingAccountConversations(t,requestUrl,decode(accountConv[1])));return true;}
  if(path==="/api/reporting/accounts"){const t=await requireReportingToken(req,["accounts:read"]);sendJson(res,200,await listReportingAccounts(t,requestUrl));return true;}
  if(path==="/api/reporting/guests"){const t=await requireReportingToken(req,["guests:read"]);sendJson(res,200,await listReportingGuests(t,requestUrl));return true;}
  return false;
}
function decode(v){try{return decodeURIComponent(v);}catch{return v;}}
