const messages = {
  required: 'Entre com o Discord para acessar a área da staff.',
  unavailable: 'O login da staff ainda está sendo configurado.',
  invalid: 'A tentativa de login expirou. Tente novamente.',
  cancelled: 'O login foi cancelado.',
  forbidden: 'Sua conta não possui o cargo ADM ou Staff.',
  error: 'Não foi possível concluir o login. Tente novamente.'
};

const joinMessages = {
  required: 'Entre com o Discord para iniciar seu cadastro.',
  unavailable: 'A entrada automática ainda está sendo configurada.',
  invalid: 'A autorização expirou. Tente entrar novamente.',
  cancelled: 'A entrada pelo Discord foi cancelada.',
  error: 'Não foi possível concluir sua entrada. Tente novamente ou procure a staff.'
};

const query = new URLSearchParams(window.location.search);
const authStatus = query.get('auth') || (query.has('login') ? 'required' : null);
const joinStatus = query.get('join');
const portalMessages = {
  required: 'Entre com o Discord para acessar seu portal.',
  forbidden: 'Você precisa estar no Discord da Notag para acessar o portal.'
};
const portalStatus = query.get('portal');
const toast = document.querySelector('#auth-message');
const message = portalStatus ? portalMessages[portalStatus] : (joinStatus ? joinMessages[joinStatus] : messages[authStatus]);
if (message) {
  toast.textContent = message;
  toast.hidden = false;
  window.setTimeout(() => { toast.hidden = true; }, 7000);
}
