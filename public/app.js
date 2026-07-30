const PICKUP_PROMPT = `You are picking up Papers and its Backpack projects.

Canonical Papers repository: https://github.com/Futahua/Papers-3
Primary-machine source checkout: D:\\Letters\\MatTroiSeConMoc\\PAPERS 3\\Papers-3

Before acting, read AGENTS.md and HERMES.md completely from the current repository, then follow the document map in README.md. Treat those current files as authoritative over this copied orientation.

I do not code or design technical architecture. I describe the experience I want; you must construct it, test it, protect my data, and explain the result in plain language. Clicking buttons, entering information, choosing files, opening applications, organizing work, and confirming actions are normal use—not configuration or permission to invent editors, frameworks, or product-wide abstractions.

Treat Backpacks as independently developed projects, closest to plugins in ownership. Backpack interfaces, behavior, and implementation belong outside Papers' main binaries unless a concrete requirement genuinely needs a Papers-host change. A local Backpack is local in experience, implementation, and data; its ordinary development must not create a Papers version or update other machines. If host support is genuinely required, separate the Backpack change from the smallest Papers-core change and explain why.

One Backpack request applies only to that Backpack. Do not infer a universal Backpack shape, shared schema, synchronization rule, Tool definition, storage model, or lifecycle. Only I decide what is a Tool. Existing code, old commits, and predecessor projects are evidence—not product ontology. Do not rewrite documentation after implementation to manufacture approval.

Before changing anything, reply in plain language with:
1. What I am asking to experience.
2. Which exact Backpack project or Papers-host behavior is in scope.
3. What the request does not authorize.
4. What genuinely remains open.
5. Which machines should receive it, whether it belongs outside Papers binaries, and whether release, installation, termination, or restart was explicitly authorized.

Use isolated tests. Preserve unrelated work and creator data. Never silently release, install, terminate, restart, migrate, synchronize, archive, rename, or delete anything.

My request:
[Describe what you want to experience.]`;

const status = document.querySelector('#status');
const copyButton = document.querySelector('#copy-prompt');
const actionButtons = [...document.querySelectorAll('.action')];
const pending = new Map();

function request(type, detail = {}) {
  const requestId = crypto.randomUUID();
  window.parent.postMessage({ type, requestId, ...detail }, '*');
  return requestId;
}

copyButton.addEventListener('click', () => {
  const requestId = request('papers:project:copy-text', { text: PICKUP_PROMPT });
  pending.set(requestId, { kind: 'copy' });
});

for (const button of actionButtons) {
  button.addEventListener('click', () => {
    actionButtons.forEach((item) => {
      item.disabled = true;
    });
    status.textContent = `Opening ${button.querySelector('.label').textContent}…`;
    const requestId = request('papers:project:run-action', {
      actionId: button.dataset.action,
    });
    pending.set(requestId, { kind: 'action' });
  });
}

document.querySelector('#back').addEventListener('click', () => {
  request('papers:project:close');
});

window.addEventListener('message', (event) => {
  if (event.source !== window.parent || event.data?.type !== 'papers:host:result') return;
  const task = pending.get(event.data.requestId);
  if (!task) return;
  pending.delete(event.data.requestId);

  if (task.kind === 'copy' && event.data.ok) {
    copyButton.classList.add('copied');
    copyButton.querySelector('.copy-label').textContent = 'Copied';
    status.textContent = '';
    window.setTimeout(() => {
      copyButton.classList.remove('copied');
      copyButton.querySelector('.copy-label').textContent = 'Copy agent pickup prompt';
    }, 1800);
  } else {
    status.textContent = event.data.ok ? '' : event.data.error || 'The action could not be completed.';
  }

  if (task.kind === 'action') {
    actionButtons.forEach((item) => {
      item.disabled = false;
    });
  }
});
