import assert from "node:assert/strict";
import dns from "node:dns/promises";
import fs from "node:fs";
import {
  registerTtmallAccount,
  requestTtmallAccountCaptcha,
  resetTtmallAccountCaptchaSessionsForTests,
  signInTtmallAccount,
} from "../server/ttmall-account-client-service.js";
import { normalizeCacheProducts } from "../server/kitshop-shelf-builder.js";
import { resetTtmallClientCachesForTests } from "../server/product-source-ttmall-client-service.js";

const source = {
  apiBaseUrl: "https://api.example.com",
  websiteId: "4",
  cacheKey: "https://api.example.com|4",
};
const sessionScope = { userId: "user-test", siteId: "site-test" };
const originalFetch = globalThis.fetch;
const originalLookup = dns.lookup;
const originalWindow = globalThis.window;
const originalCustomEvent = globalThis.CustomEvent;
const requests = [];
let signInResponse = { code: 1001, message: "verification failed" };

try {
  resetTtmallClientCachesForTests();
  dns.lookup = async (hostname, options = {}) => {
    if (hostname === "api.example.com") {
      return options.all ? [{ address: "93.184.216.34", family: 4 }] : { address: "93.184.216.34", family: 4 };
    }
    return originalLookup(hostname, options);
  };
  globalThis.fetch = async (url, options = {}) => {
    const requestUrl = new URL(String(url));
    requests.push({ requestUrl, options });
    if (requestUrl.hostname === "cloudflare-dns.com") {
      return jsonResponse({ Answer: [{ type: 1, data: "93.184.216.34" }] });
    }
    if (requestUrl.pathname === "/v1/token/4") {
      return jsonResponse({ data: buildJwt({ websiteId: "4" }) });
    }
    assert.match(options.headers.Authorization || "", /^Bearer /, "account calls must reuse the server-side site token");
    if (requestUrl.pathname === "/v1/user/verify") {
      assert.ok(["1", "2"].includes(requestUrl.searchParams.get("id")), "captcha purpose must remain server mapped");
      return binaryResponse("captcha-image-payload-that-is-long-enough-for-normalization", "image/png", 200, {
        "set-cookie": "PHPSESSID=opaque-provider-session; Path=/; HttpOnly",
      });
    }
    if (requestUrl.pathname === "/v1/user/sign") {
      assert.equal(options.method, "POST", "sign in must use the fixed POST endpoint");
      assert.deepEqual(JSON.parse(options.body), {
        email: "person@example.com",
        password: "not-persisted",
        checkcode: "1234",
      });
      assert.equal(options.headers.Cookie, "PHPSESSID=opaque-provider-session", "sign-in must forward the server-held captcha cookie");
      return jsonResponse(signInResponse);
    }
    if (requestUrl.pathname === "/v1/user/register") {
      assert.equal(options.method, "POST", "registration must use the fixed POST endpoint");
      assert.deepEqual(JSON.parse(options.body), {
        email: "new@example.com",
        password: "letter1",
        repassword: "letter1",
        checkcode: "5678",
      });
      assert.equal(options.headers.Cookie, "PHPSESSID=opaque-provider-session", "registration must forward the server-held captcha cookie");
      return jsonResponse({
        code: 200,
        message: "Success",
        data: {
          token: "provider-session-token",
          user_info: { user_id: "tt-user-123", email: "new@example.com" },
        },
      });
    }
    throw new Error(`unexpected request ${requestUrl}`);
  };

  const captcha = await requestTtmallAccountCaptcha(source, "login", { sessionScope });
  assert.equal(captcha.purpose, "login");
  assert.match(captcha.captcha, /^data:image\/png;base64,/, "base64 captchas must be rendered without exposing the provider response");
  assert.match(captcha.captchaSessionId, /^[A-Za-z0-9_-]{20,}$/, "the browser may receive only an opaque captcha session identifier");
  assert.doesNotMatch(JSON.stringify(captcha), /opaque-provider-session/, "provider cookies must never leave server memory");
  await assert.rejects(
    () => signInTtmallAccount(source, {
      email: "person@example.com",
      password: "not-persisted",
      checkcode: "1234",
      captchaSessionId: captcha.captchaSessionId,
    }, { sessionScope }),
    (error) => error?.publicCode === "TTMALL_CAPTCHA_INVALID",
    "a rejected verification code must be converted to a specific controlled public error",
  );
  signInResponse = { code: 1003, message: "provider message is not relied on" };
  const invalidRequestCaptcha = await requestTtmallAccountCaptcha(source, "login", { sessionScope });
  await assert.rejects(
    () => signInTtmallAccount(source, {
      email: "person@example.com",
      password: "not-persisted",
      checkcode: "1234",
      captchaSessionId: invalidRequestCaptcha.captchaSessionId,
    }, { sessionScope }),
    (error) => error?.publicCode === "TTMALL_ACCOUNT_REQUEST_INVALID",
    "documented TTMall parameter errors must not become a generic binding failure",
  );
  signInResponse = { code: 1005, message: "provider message is not relied on" };
  const existingEmailCaptcha = await requestTtmallAccountCaptcha(source, "login", { sessionScope });
  await assert.rejects(
    () => signInTtmallAccount(source, {
      email: "person@example.com",
      password: "not-persisted",
      checkcode: "1234",
      captchaSessionId: existingEmailCaptcha.captchaSessionId,
    }, { sessionScope }),
    (error) => error?.publicCode === "TTMALL_EMAIL_EXISTS",
    "documented TTMall duplicate-email errors must lead users to sign in",
  );
  signInResponse = { code: 1001, message: "verification failed" };
  await assert.rejects(
    () => signInTtmallAccount(source, {
      email: "person@example.com",
      password: "not-persisted",
      checkcode: "1234",
      captchaSessionId: captcha.captchaSessionId,
    }, { sessionScope }),
    (error) => error?.publicCode === "TTMALL_CAPTCHA_SESSION_INVALID",
    "a captcha session must be single-use and cannot replay a provider cookie",
  );
  await assert.rejects(
    () => registerTtmallAccount(source, {
      email: "new@example.com",
      password: "123456",
      confirmPassword: "123456",
      checkcode: "5678",
    }),
    (error) => error?.publicCode === "TTMALL_PASSWORD_FORMAT_INVALID",
    "registration must reject passwords that TTMall will deterministically reject",
  );
  const registerCaptcha = await requestTtmallAccountCaptcha(source, "register", { sessionScope });
  await assert.rejects(
    () => registerTtmallAccount(source, {
      email: "new@example.com",
      password: "letter1",
      confirmPassword: "letter1",
      checkcode: "5678",
      captchaSessionId: registerCaptcha.captchaSessionId,
    }, { sessionScope: { userId: "another-user", siteId: "site-test" } }),
    (error) => error?.publicCode === "TTMALL_CAPTCHA_SESSION_INVALID",
    "captcha sessions must stay bound to the AIOVE user and site",
  );
  const usableRegisterCaptcha = await requestTtmallAccountCaptcha(source, "register", { sessionScope });
  const registered = await registerTtmallAccount(source, {
    email: "new@example.com",
    password: "letter1",
    confirmPassword: "letter1",
    checkcode: "5678",
    captchaSessionId: usableRegisterCaptcha.captchaSessionId,
  }, { sessionScope });
  assert.equal(registered.externalUserId, "ttmall:tt-user-123", "registration must use TTMall user_info as the external identity");
  assert.equal(registered.email, "new@example.com", "registration must preserve the provider-confirmed email");
  assert.equal(registered.token, "provider-session-token", "registration must preserve the provider session token only for encrypted binding storage");
  assert.equal(requests.filter(({ requestUrl }) => requestUrl.pathname === "/v1/token/4").length, 1, "captcha and sign-in must share the short-lived service token cache");
  await assertBindingCredentialFailuresKeepAioveSession();

  const routeSource = fs.readFileSync("server/ttmall-account-binding-routes.js", "utf8");
  const bindingSource = fs.readFileSync("server/ttmall-account-binding-service.js", "utf8");
  const runtimeAccessSource = fs.readFileSync("server/ttmall-runtime-access-service.js", "utf8");
  const configSource = fs.readFileSync("server/config.js", "utf8");
  const panelSource = fs.readFileSync("src/features/chat/chat-ttmall-binding-panel.js", "utf8");
  const chatStyles = fs.readFileSync("src/features/app-shell/styles/chat.css", "utf8");
  const responsiveStyles = fs.readFileSync("src/features/app-shell/styles/app-responsive.css", "utf8");
  const searchStyles = fs.readFileSync("src/features/app-shell/styles/search.css", "utf8");
  const kitshopStyles = fs.readFileSync("src/features/app-shell/styles/kitshop.css", "utf8");
  const callStyles = fs.readFileSync("src/features/app-shell/styles/call-modal.css", "utf8");
  const migrationSource = fs.readFileSync("server/db-bootstrap-commerce-tables.js", "utf8");
  assert.match(routeSource, /requireAuth/, "all binding routes must require an AIOVE session");
  assert.match(routeSource, /assertPublicAppOrigin/, "binding writes must enforce the public origin guard");
  assert.match(routeSource, /MAX_BINDING_BODY_BYTES/, "binding writes must keep a bounded request body");
  assert.match(routeSource, /sessionScope: \{ userId: user.id, siteId: access.site.id \}/, "captcha sessions must be scoped to the authenticated user and current site");
  assert.match(runtimeAccessSource, /api\.taotens\.com/, "local test mode must stay pinned to the test host");
  assert.match(runtimeAccessSource, /TTMALL_LOCAL_TEST_LOOPBACK_REQUIRED/, "local test mode must require loopback-only app URLs");
  assert.match(runtimeAccessSource, /TTMALL_PRODUCTION_SOURCE_REQUIRED/, "production access must require a public HTTPS site source");
  assert.match(runtimeAccessSource, /createPublicError\(message, 503, code\)/, "runtime configuration failures must remain controlled public errors instead of generic HTTP 500s");
  assert.match(runtimeAccessSource, /sourceUrl\.port/, "production access must reject a custom TTMall source port");
  assert.match(migrationSource, /UNIQUE KEY uniq_ttmall_account_binding_owner/, "one AIOVE user must only have one binding per site");
  assert.match(migrationSource, /UNIQUE KEY uniq_ttmall_account_binding_external/, "one TTMall identity must not bind to two AIOVE users for one site");
  assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS ttmall_binding_candidates/, "registration follow-up must use a separate pending-auth candidate table instead of a fake active binding");
  assert.match(migrationSource, /access_token_expires_at/, "a provider-reported token expiry must have a local lifecycle field");
  assert.match(bindingSource, /encryptSecret\(normalizedToken/, "TTMall tokens must be encrypted at rest");
  assert.match(configSource, /ttmallAccountBinding: Object\.freeze/, "TTMall binding secret must be wired into the runtime config");
  assert.doesNotMatch(bindingSource, /password_encrypted|password_hash|password\s*=/i, "TTMall passwords must never be stored by the binding service");
  assert.match(bindingSource, /recordTtmallBindingCandidate/, "registration must record only a pending TTMall-auth candidate");
  assert.match(bindingSource, /ensureActiveTtmallBinding/, "all bound-user actions must have a token lifecycle gate");
  assert.match(bindingSource, /token_expired/, "known token expiry must become a deterministic stale binding state");
  assert.match(bindingSource, /DELETE FROM ttmall_binding_candidates/, "successful binding and unlink must clear the pending candidate");
  assert.match(panelSource, /product-cart-panel ttmall-account-binding-panel/, "the binding UI must reuse the cart panel container");
  assert.match(panelSource, /getSiteBranding\(state\.siteSlug\)/, "the binding panel header must read current-site branding");
  assert.match(panelSource, /data-ttmall-binding-brand-image/, "the binding panel must reserve the current site logo in its header");
  assert.match(panelSource, /ttmall-binding-security-note/, "the external-account security note must remain beneath the verification controls");
  assert.match(panelSource, /prefillEmail/, "a pending TTMall candidate must prefill only its email, never a password");
  assert.match(panelSource, /never stored or shared/, "the binding UI must explain that a matching AIOVE password is still one-time only");
  assert.ok(
    panelSource.indexOf("ttmall-binding-security-note") > panelSource.indexOf("ttmall-binding-captcha-row"),
    "the external-account security note must render below the verification controls",
  );
  assert.match(panelSource, /class="btn \$\{!isRegister \? "btn-primary" : "btn-ghost"\}"/, "the sign-in action must reuse the login button classes");
  assert.match(panelSource, /class="btn \$\{isRegister \? "btn-primary" : "btn-ghost"\}"/, "the account-creation action must reuse the login button classes");
  assert.match(panelSource, /login-card-title ttmall-binding-brand/, "the binding title must reuse the login title class");
  assert.match(panelSource, /class="pp-close product-cart-close"/, "the binding header close control must reuse the product-panel close button");
  assert.match(chatStyles, /\.ttmall-binding-tabs \.btn \{ width: 100%; \}/, "the reused login buttons must still fill the two-column binding action row");
  assert.match(chatStyles, /\.ttmall-binding-brand \{[^}]*font-size: 14px/, "the binding brand title must be half the login-page title size");
  assert.match(chatStyles, /\.ttmall-binding-brand-logo \{[^}]*width: 15px; height: 15px; flex: 0 0 15px/, "the binding brand logo must be half its original size");
  assert.match(chatStyles, /\.ttmall-binding-form \.field \{[^}]*color: var\(--ink-2\)/, "binding field labels must reuse the login page field-title color");
  assert.match(chatStyles, /\.ttmall-binding-form input:focus \{[^}]*border-color: var\(--accent\);[^}]*box-shadow: 0 0 0 3px var\(--accent-soft\)/, "binding inputs must reuse the login page focus state");
  assert.match(responsiveStyles, /--mobile-product-panel-height:\s*88vh/, "mobile product detail must define the shared sheet height once");
  assert.match(responsiveStyles, /\.prod-panel\s*\{[^}]*height:\s*var\(--mobile-product-panel-height\);[^}]*max-height:\s*var\(--mobile-product-panel-height\)/, "mobile product detail must consume the shared sheet height");
  assert.match(chatStyles, /\.product-cart-panel,\s*\.ttmall-account-binding-panel\s*\{[^}]*height:\s*var\(--mobile-product-panel-height\);[^}]*max-height:\s*var\(--mobile-product-panel-height\)/, "mobile cart and binding sheets must consume the product detail height");
  assert.match(searchStyles, /\[data-product-cart-panel\][^{]*\{[^}]*z-index: 80/, "search cart must stay above the mobile product sheet");
  assert.match(searchStyles, /\[data-ttmall-account-binding\][^{]*\{[^}]*z-index: 84/, "search binding must stay above cart");
  assert.match(searchStyles, /body\[data-view="search"\]\s*\{\s*--mobile-product-panel-height:/, "search must override the shared mobile sheet height once for its topbar-safe viewport");
  assert.match(searchStyles, /\.search-prod-panel\s*\{[^}]*height:\s*var\(--mobile-product-panel-height\);[^}]*max-height:\s*var\(--mobile-product-panel-height\)/, "search product detail must use the shared sheet height");
  assert.match(kitshopStyles, /\[data-product-cart-panel\][^{]*\{[^}]*z-index: 80/, "Kitshop cart must stay above the mobile product sheet");
  assert.match(kitshopStyles, /\[data-ttmall-account-binding\][^{]*\{[^}]*z-index: 84/, "Kitshop binding must stay above cart");
  assert.match(callStyles, /\[data-product-cart-panel\]\{ z-index:124; \}/, "call cart must keep its overlay layer");
  assert.match(callStyles, /\[data-ttmall-account-binding\]\{ z-index:125; \}/, "call binding must stay above its cart");
  assert.match(callStyles, /--call-product-mobile-panel-height:calc\(100dvh - 12px\)/, "mobile call overlay must define one shared sheet height");
  assert.match(callStyles, /\.call-product-panel\{[^}]*height:var\(--call-product-mobile-panel-height\);[^}]*max-height:var\(--call-product-mobile-panel-height\)/, "mobile call detail must consume its shared sheet height");
  assert.match(callStyles, /\.call-product-overlay \.product-cart-panel\{[^}]*height:var\(--call-product-mobile-panel-height\);[^}]*max-height:var\(--call-product-mobile-panel-height\)/, "mobile call cart and binding must match call detail height");
  assert.match(panelSource, /clearSensitiveFields/, "closing or binding success must clear sensitive form fields");
  assert.match(panelSource, /error\?\.payload\?\.code/, "binding panel must read controlled server error codes from ApiError payloads");
  assert.match(panelSource, /function resolveBindingErrorField/, "binding form errors must deterministically map controlled TTMall errors to a field");
  assert.match(panelSource, /TTMALL_CAPTCHA_INVALID/, "verification failures must map to the verification field");
  assert.match(panelSource, /TTMALL_CAPTCHA_SESSION_INVALID/, "expired verification sessions must map to the verification field");
  assert.match(panelSource, /captchaSessionId: state\.captchaSessionId/, "the panel may submit only an opaque captcha-session identifier");
  const bindingClientSource = fs.readFileSync("src/services/ttmall-account-binding-service.js", "utf8");
  assert.match(bindingClientSource, /notifyUnauthorized: false/, "external TTMall credential failures must not sign the AIOVE user out");
  assert.match(panelSource, /class=\"field-error\"/, "binding form errors must reuse the existing auth field-error markup");
  assert.match(panelSource, /is-field-error is-field-error-flash/, "binding form errors must reuse the existing auth input error state");
  assert.match(panelSource, /panel\.addEventListener\("input"/, "binding errors must react to the next user input without a form re-render");
  assert.match(panelSource, /function shouldClearBindingError/, "confirmation errors must clear when either password field changes");
  assert.match(panelSource, /CAPTCHA_RETRY_DELAYS_MS/, "captcha recovery must use a bounded background retry schedule");
  assert.match(panelSource, /scheduleCaptchaRetry\(panel, state\)/, "captcha failures must recover without replacing the binding panel");
  assert.match(panelSource, /clearCaptchaRetry\(state\)/, "closing or replacing a binding panel must cancel background captcha retries");
  assert.match(panelSource, /cancelCaptchaRetry\(state\)/, "background captcha retries must not reset their backoff attempt before they run");
  assert.match(panelSource, /field\.classList\.remove\("is-field-error", "is-field-error-flash"\)/, "the next relevant input must clear the reused auth error state in place");
  assert.match(panelSource, /state\.email = String\(values\.get\("ttmallEmail"\)/, "binding panel may retain only the email for a retry and must not retain passwords");
  assert.match(panelSource, /state\.onBound = typeof onBound === "function" \? onBound : null/, "the binding panel must retain a caller-provided continuation only while binding is pending");
  assert.match(panelSource, /await onBound\(result\)/, "binding success must await the caller continuation after closing the binding sheet");
  assert.match(panelSource, /name="ttmallPassword"/, "the external password field must not reuse the AIOVE login field name");
  assert.doesNotMatch(panelSource, /current-password/, "the external binding form must not invite same-origin AIOVE credential autofill");
  const cached = normalizeCacheProducts({ id: "site_local", slug: "local" }, [{
    id: "test-product",
    name: "Local TTMall product",
    url: "https://ttmall-binding-test.invalid/products/test-product",
    purchaseMode: "product_detail",
    paymentMethods: ["visa"],
    sizeChartResolved: true,
    sizeChart: { columns: ["Size", "Chest"], rows: [["S", "90–96"]] },
    sizes: [{ label: "S", available: true }],
  }]);
  assert.equal(cached[0]?.payload?.purchaseMode, "product_detail", "cached TTMall products must preserve their cart mode");
  assert.deepEqual(cached[0]?.payload?.paymentMethods, ["visa"], "cached TTMall products must preserve payment methods");
  assert.equal(cached[0]?.payload?.sizeChartResolved, true, "cached TTMall products must preserve detail hydration state");
  console.log("TTMall account binding self-check passed");
} finally {
  globalThis.fetch = originalFetch;
  dns.lookup = originalLookup;
  globalThis.window = originalWindow;
  globalThis.CustomEvent = originalCustomEvent;
  resetTtmallClientCachesForTests();
  resetTtmallAccountCaptchaSessionsForTests();
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

function binaryResponse(value, contentType, status = 200, headers = {}) {
  return new Response(value, { status, headers: { "content-type": contentType, ...headers } });
}

async function assertBindingCredentialFailuresKeepAioveSession() {
  let authExpiredEvents = 0;
  const providerFetch = globalThis.fetch;
  globalThis.window = {
    AIOVE_API_BASE_URL: "",
    localStorage: { getItem: () => "" },
    dispatchEvent(event) {
      if (event?.type === "aiove:auth-expired") authExpiredEvents += 1;
    },
  };
  globalThis.CustomEvent = class {
    constructor(type, detail) {
      this.type = type;
      this.detail = detail;
    }
  };
  globalThis.fetch = async () => jsonResponse({
    ok: false,
    error: "The verification code is incorrect or expired. Please refresh it and try again.",
    code: "TTMALL_CAPTCHA_INVALID",
  }, 401);
  try {
    const { signInTtmallAccount: requestBindingLogin } = await import("../src/services/ttmall-account-binding-service.js");
    await assert.rejects(
      () => requestBindingLogin({
        siteSlug: "ttmall-binding-test",
        email: "person@example.com",
        password: "not-persisted",
        checkcode: "1234",
        captchaSessionId: "opaque-captcha-session-id",
      }),
      (error) => error?.payload?.code === "TTMALL_CAPTCHA_INVALID",
      "external credential failures must remain visible to the binding form",
    );
    assert.equal(authExpiredEvents, 0, "external TTMall 401 responses must not clear the AIOVE session");
  } finally {
    globalThis.fetch = providerFetch;
  }
}

function buildJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 600 })).toString("base64url");
  return `${header}.${body}.signature`;
}
