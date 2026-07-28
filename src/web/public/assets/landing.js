const messages = {
  required: 'Entre com o Discord para acessar a área da staff.',
  unavailable: 'O login da staff ainda está sendo configurado.',
  invalid: 'A tentativa de login expirou. Tente novamente.',
  cancelled: 'O login foi cancelado.',
  forbidden: 'Sua conta não possui o cargo ADM ou Staff.',
  error: 'Não foi possível concluir o login. Tente novamente.'
};

const query = new URLSearchParams(window.location.search);
const status = query.get('auth') || (query.has('login') ? 'required' : null);
const toast = document.querySelector('#auth-message');
if (status && messages[status]) {
  toast.textContent = messages[status];
  toast.hidden = false;
  window.setTimeout(() => { toast.hidden = true; }, 7000);
}
