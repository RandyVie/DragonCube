/* Simple password screen. Light protection only: it keeps casual visitors out,
 * it is not real security (the game files themselves are public on GitHub Pages).
 * Only the SHA-256 hash of the password is stored here. */
(function () {
  const HASH = '08fcdcd06e825746d08fff6d833b09716cf00f7b6cb83820c402ef9d07952c7a';
  const KEY = 'dragoncube.unlocked';
  const gate = document.getElementById('gate');
  const read = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
  if (read() === HASH) { gate.remove(); return; }
  document.documentElement.classList.add('locked');
  const form = document.getElementById('gate-form'), input = document.getElementById('gate-pw'), err = document.getElementById('gate-err');
  async function sha256(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  form.addEventListener('submit', async e => {
    e.preventDefault();
    let ok = false;
    try { ok = (await sha256(input.value)) === HASH; } catch { err.textContent = 'Open this page over https to unlock it.'; return; }
    if (!ok) { err.textContent = 'Wrong password. Try again.'; input.select(); form.classList.remove('shake'); void form.offsetWidth; form.classList.add('shake'); return; }
    try { localStorage.setItem(KEY, HASH); } catch { /* remember for this visit only */ }
    document.documentElement.classList.remove('locked');
    gate.classList.add('open');
    setTimeout(() => gate.remove(), 500);
  });
  input.focus();
})();
