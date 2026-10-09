/**
 * SCHOOLAR — Messagerie interne (annexe section 7)
 */
const MessagesPage = {
  state: {
    conversations: [],
    selectedConversationId: null,
    messages: [],
    showNewConv: false,
    contactResults: [],
  },

  async render(root) {
    const user = Store.getUser();
    if (!user) { window.location.hash = '#/login'; return; }
    this.root = root;
    this.user = user;

    await this.loadConversations();
    this.paint();
  },

  async loadConversations() {
    try {
      const d = await API.listConversations();
      this.state.conversations = d.conversations;
    } catch (err) { UI.toast(err.message || 'Erreur.', 'error'); }
  },

  paint() {
    const navItems = DashboardPage.buildNavItems(this.user).map(i => ({ ...i, active: i.href === '#/messages' }));

    const body = `
      <div class="flex justify-between items-center">
        <div>
          <h2>${t('messages_title')}</h2>
          <p class="text-muted text-sm mt-8">${t('messages_subtitle')}</p>
        </div>
        <button class="btn btn-primary btn-sm" id="btn-new-conv">${t('btn_new_conversation')}</button>
      </div>

      <div id="new-conv-container" class="mt-16"></div>

      <div class="mt-24" style="display:grid;grid-template-columns:300px 1fr;gap:16px;min-height:420px;">
        <div id="conversation-list" class="card" style="padding:8px;"></div>
        <div id="conversation-chat" class="card"></div>
      </div>
    `;

    const content = UI.renderShell(this.root, { user: this.user, navItems, pageBodyHtml: body });
    this.content = content;

    content.querySelector('#btn-new-conv').addEventListener('click', () => {
      this.state.showNewConv = !this.state.showNewConv;
      this.paintNewConv();
    });

    this.paintList();
    this.paintChat();
  },

  paintNewConv() {
    const container = this.content.querySelector('#new-conv-container');
    if (!this.state.showNewConv) { container.innerHTML = ''; return; }

    container.innerHTML = `
      <div class="card">
        <div class="field-input-wrap">${UI.icon('search', 16)}<input id="contact-search" placeholder="${t('field_search_contact')}"></div>
        <div id="contact-results" class="mt-16"></div>
      </div>
    `;

    const search = container.querySelector('#contact-search');
    search.addEventListener('input', this.debounce(async (e) => {
      try {
        const d = await API.searchContacts(e.target.value);
        this.state.contactResults = d.contacts;
        this.paintContactResults();
      } catch {}
    }, 300));

    search.dispatchEvent(new Event('input'));
  },

  debounce(fn, delay) {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); };
  },

  paintContactResults() {
    const container = this.content.querySelector('#contact-results');
    if (!container) return;
    container.innerHTML = this.state.contactResults.map(c => `
      <div class="flex items-center justify-between" style="padding:8px 0;border-bottom:1px solid var(--color-border);">
        <div class="flex items-center gap-8">
          <div class="avatar">${UI.initials(c.first_name, c.last_name)}</div>
          <div>
            <div>${c.first_name} ${c.last_name}</div>
            <div class="text-muted text-sm">${I18N.current === 'fr' ? c.role_label_fr : c.role_label_en}</div>
          </div>
        </div>
        <button class="btn btn-outline btn-sm" data-start="${c.id}">${t('btn_new_conversation')}</button>
      </div>
    `).join('');

    container.querySelectorAll('[data-start]').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          const d = await API.startConversation(btn.dataset.start);
          this.state.showNewConv = false;
          await this.loadConversations();
          this.state.selectedConversationId = d.conversation_id;
          await this.loadMessages();
          this.paint();
        } catch (err) { UI.toast(err.message || 'Erreur.', 'error'); }
      });
    });
  },

  paintList() {
    const container = this.content.querySelector('#conversation-list');
    if (!this.state.conversations.length) {
      container.innerHTML = `<div class="empty-state">${UI.icon('users', 26)}<p class="mt-8 text-sm">${t('empty_conversations')}</p></div>`;
      return;
    }
    container.innerHTML = this.state.conversations.map(c => `
      <div class="flex items-center gap-8" data-conv="${c.id}" style="padding:10px 8px;border-radius:10px;cursor:pointer;${this.state.selectedConversationId === c.id ? 'background:var(--color-primary-light);' : ''}">
        <div class="avatar">${UI.initials(c.other_first_name, c.other_last_name)}</div>
        <div style="flex:1;min-width:0;">
          <div class="flex justify-between items-center">
            <strong style="font-size:13.5px;">${c.other_first_name} ${c.other_last_name}</strong>
            ${c.unread_count > 0 ? `<span class="badge badge-danger" style="font-size:10px;padding:2px 7px;">${c.unread_count}</span>` : ''}
          </div>
          <div class="text-muted text-sm" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${c.last_message_body || ''}</div>
        </div>
      </div>
    `).join('');

    container.querySelectorAll('[data-conv]').forEach(row => {
      row.addEventListener('click', async () => {
        this.state.selectedConversationId = row.dataset.conv;
        await this.loadMessages();
        await this.loadConversations();
        this.paint();
      });
    });
  },

  async loadMessages() {
    try {
      const d = await API.getMessages(this.state.selectedConversationId);
      this.state.messages = d.messages;
    } catch (err) { UI.toast(err.message || 'Erreur.', 'error'); }
  },

  paintChat() {
    const container = this.content.querySelector('#conversation-chat');
    if (!this.state.selectedConversationId) {
      container.innerHTML = `<div class="empty-state" style="margin:auto;">${UI.icon('users', 30)}</div>`;
      return;
    }

    container.innerHTML = `
      <div style="display:flex;flex-direction:column;height:420px;">
        <div id="chat-messages" style="flex:1;overflow-y:auto;padding:12px;">
          ${this.state.messages.map(m => `
            <div style="display:flex;${m.sender_id === this.user.id ? 'justify-content:flex-end;' : ''}margin-bottom:10px;">
              <div style="max-width:70%;padding:10px 14px;border-radius:14px;background:${m.sender_id === this.user.id ? 'var(--color-primary)' : 'var(--color-bg)'};color:${m.sender_id === this.user.id ? 'white' : 'var(--color-text)'};">
                <div style="font-size:14px;">${m.body}</div>
                <div style="font-size:11px;opacity:.7;margin-top:4px;">${new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
              </div>
            </div>
          `).join('')}
        </div>
        <div class="flex gap-8" style="padding:12px;border-top:1px solid var(--color-border);">
          <input id="chat-input" placeholder="${t('field_message_placeholder')}" style="flex:1;padding:10px;border:1px solid var(--color-border);border-radius:20px;">
          <button class="btn btn-primary btn-sm" id="chat-send">${t('btn_send')}</button>
        </div>
      </div>
    `;

    const scrollBox = container.querySelector('#chat-messages');
    scrollBox.scrollTop = scrollBox.scrollHeight;

    const send = async () => {
      const input = container.querySelector('#chat-input');
      const body = input.value.trim();
      if (!body) return;
      input.value = '';
      try {
        await API.sendMessage(this.state.selectedConversationId, body);
        await this.loadMessages();
        this.paintChat();
      } catch (err) { UI.toast(err.message || 'Erreur.', 'error'); }
    };

    container.querySelector('#chat-send').addEventListener('click', send);
    container.querySelector('#chat-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
  },
};
