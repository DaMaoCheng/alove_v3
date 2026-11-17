// The public interface and chat source projection use the same access policy.
export const AGE_GATE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
export const AGE_GATE_EXEMPT_PATH_PREFIXES = Object.freeze(['/admin', '/creator']);
export const PLATFORM_CHAT_ACCESS_FACTS = Object.freeze({
  minimumAge: 18,
  adultConfirmationRequired: true,
  noticeMayIncludeAdultElements: true,
  characterRolesMayVary: true,
});
export const PLATFORM_ACCESS_SOURCE_CONTRACT = 'These server-owned facts describe this chat platform interface, not the associated merchant. Public chat entry asks visitors to confirm they are 18 or older; its notice says the platform may include adult elements and offers different AI character roles. This supports explaining the access notice in natural character language. It does not establish legal reasons, actual visitor age, any specific conversation content, that every role supplies adult material, or any merchant/payment/shipping policy. Acknowledge those limits when relevant; do not replace an interface explanation with an inability to verify merchant terms.';
