export function bindConfirmPasswordValidation(root, {
  passwordSelector = "input[name='password']",
  confirmSelector = "input[name='confirmPassword']",
  message = "Passwords do not match.",
} = {}) {
  const passwordInput = root?.querySelector?.(passwordSelector);
  const confirmInput = root?.querySelector?.(confirmSelector);
  if (!(passwordInput instanceof HTMLInputElement) || !(confirmInput instanceof HTMLInputElement)) {
    return () => true;
  }

  const error = document.createElement("p");
  error.className = "field-error";
  error.hidden = true;
  error.textContent = message;
  const confirmField = confirmInput.closest(".field");
  confirmField?.append(error);

  const clear = () => {
    error.hidden = true;
    passwordInput.classList.remove("is-field-error", "is-field-error-flash");
    confirmInput.classList.remove("is-field-error", "is-field-error-flash");
  };

  const validate = ({ flash = false } = {}) => {
    const password = passwordInput.value;
    const confirmPassword = confirmInput.value;
    if (!password || !confirmPassword || password === confirmPassword) {
      clear();
      return true;
    }

    error.hidden = false;
    passwordInput.classList.add("is-field-error");
    confirmInput.classList.add("is-field-error");
    if (flash) {
      restartFlash(passwordInput);
      restartFlash(confirmInput);
    }
    return false;
  };

  const validateWhenInactive = () => {
    window.setTimeout(() => {
      if (document.activeElement === passwordInput || document.activeElement === confirmInput) return;
      validate({ flash: true });
    }, 0);
  };

  passwordInput.addEventListener("input", clear);
  confirmInput.addEventListener("input", clear);
  passwordInput.addEventListener("blur", validateWhenInactive);
  confirmInput.addEventListener("blur", validateWhenInactive);

  return validate;
}

function restartFlash(input) {
  input.classList.remove("is-field-error-flash");
  void input.offsetWidth;
  input.classList.add("is-field-error-flash");
}
