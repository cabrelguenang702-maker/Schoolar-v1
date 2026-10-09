/**
 * SCHOOLAR — Passage d'une épreuve de préparation aux concours (section 12).
 * Chronomètre, soumission des réponses, correction automatique (IA GPT côté
 * serveur), affichage des résultats et lien vers le classement établissement.
 */
const ExamTakingPage = {
  state: {
    exam: null,
    attempt: null,
    answers: {},
    remainingSeconds: 0,
    timerHandle: null,
  },

  async render(root, params) {
    const user = Store.getUser();
    if (!user) { window.location.hash = '#/login'; return; }
    this.root = root;
    this.user = user;
    this.examId = params.id;

    await this.load();
    this.paint();
  },

  async load() {
    try {
      const data = await API.getExam(this.examId);
      this.state.exam = data.exam;
      this.state.attempt = data.attempt;
    } catch (err) {
      UI.toast(err.message || 'Erreur.', 'error');
    }
  },

  paint() {
    if (this.state.timerHandle) { clearInterval(this.state.timerHandle); this.state.timerHandle = null; }

    const navItems = DashboardPage.buildNavItems(this.user);
    const exam = this.state.exam;

    if (!exam) {
      UI.renderShell(this.root, { user: this.user, navItems, pageBodyHtml: `<div class="card"><p>${t('exam_not_found')}</p></div>` });
      return;
    }

    const attempt = this.state.attempt;

    let bodyHtml;
    if (!attempt) {
      bodyHtml = this.renderIntro(exam);
    } else if (attempt.status === 'in_progress') {
      bodyHtml = this.renderQuestions(exam, attempt);
    } else {
      bodyHtml = this.renderResults(exam, attempt);
    }

    const content = UI.renderShell(this.root, { user: this.user, navItems, pageBodyHtml: bodyHtml });
    this.content = content;

    if (!attempt) {
      content.querySelector('#exam-start-btn')?.addEventListener('click', () => this.handleStart());
    } else if (attempt.status === 'in_progress') {
      this.wireQuestionForm(content, exam, attempt);
      this.startTimer(exam, attempt);
    } else {
      content.querySelector('#exam-view-ranking')?.addEventListener('click', () => this.loadRanking(content));
    }
  },

  renderIntro(exam) {
    return `
      <h2>${exam.subject_label} — ${exam.level}</h2>
      <div class="card mt-16">
        <p>${I18N.current === 'fr' ? 'Difficulté' : 'Difficulty'}: <span class="badge badge-info">${exam.difficulty}</span></p>
        <p class="mt-8">${I18N.current === 'fr' ? 'Durée' : 'Duration'}: ${exam.time_limit_minutes} min</p>
        <p class="mt-8">${I18N.current === 'fr' ? 'Nombre de questions' : 'Questions'}: ${exam.questions.length}</p>
        <p class="text-muted text-sm mt-16">${I18N.current === 'fr' ? 'Le chronomètre démarre dès que vous cliquez sur Commencer. La soumission est automatique à la fin du temps imparti.' : 'The timer starts as soon as you click Start. Submission is automatic when time runs out.'}</p>
        <button class="btn btn-primary mt-16" id="exam-start-btn">${t('btn_start_exam')}</button>
      </div>
    `;
  },

  renderQuestions(exam, attempt) {
    return `
      <div class="flex justify-between items-center" style="flex-wrap:wrap;">
        <h2>${exam.subject_label} — ${exam.level}</h2>
        <div class="hero-card" style="padding:8px 16px;"><span id="exam-timer" style="font-size:20px;font-weight:700;">--:--</span></div>
      </div>
      <form id="exam-form" class="mt-16">
        ${exam.questions.map((q, i) => `
          <div class="card mt-16">
            <p><strong>${i + 1}.</strong> ${q.prompt}</p>
            ${q.type === 'mcq' ? `
              <div class="mt-8">
                ${(q.options || []).map(opt => `
                  <label class="flex items-center gap-8" style="padding:6px 0;">
                    <input type="radio" name="q-${q.id}" value="${opt.replace(/"/g, '&quot;')}">
                    <span>${opt}</span>
                  </label>
                `).join('')}
              </div>
            ` : `
              <div class="field-input-wrap mt-8"><textarea name="q-${q.id}" rows="3" style="width:100%;padding:10px;border:1px solid var(--color-border);border-radius:8px;"></textarea></div>
            `}
          </div>
        `).join('')}
        <button type="submit" class="btn btn-primary mt-16" id="exam-submit-btn">${t('btn_submit_exam')}</button>
      </form>
    `;
  },

  renderResults(exam, attempt) {
    const feedback = attempt.feedback || {};
    return `
      <h2>${exam.subject_label} — ${exam.level}</h2>
      <div class="hero-card mt-16" style="padding:20px;">
        <div class="hero-value">${attempt.score} <small>/ ${attempt.max_score}</small></div>
        <p class="text-muted text-sm mt-8">${t('exam_submitted')}</p>
      </div>
      ${exam.questions.map((q, i) => {
        const fb = feedback[q.id] || {};
        return `
          <div class="card mt-16">
            <p><strong>${i + 1}.</strong> ${q.prompt}</p>
            <p class="text-sm mt-8">${I18N.current === 'fr' ? 'Votre réponse' : 'Your answer'}: ${(attempt.answers && attempt.answers[q.id]) || '—'}</p>
            ${q.correct_answer ? `<p class="text-sm mt-8">${I18N.current === 'fr' ? 'Réponse attendue' : 'Expected answer'}: ${q.correct_answer}</p>` : ''}
            <div class="flex items-center gap-8 mt-8">
              ${fb.correct === true ? `<span class="badge badge-success">${I18N.current === 'fr' ? 'Correct' : 'Correct'}</span>` : fb.correct === false ? `<span class="badge badge-danger">${I18N.current === 'fr' ? 'Incorrect' : 'Incorrect'}</span>` : `<span class="badge badge-warning">${t('exam_manual_correction_needed')}</span>`}
              <span class="text-sm text-muted">${fb.points_awarded ?? 0} / ${q.points} pts</span>
            </div>
            ${fb.explanation ? `<p class="text-muted text-sm mt-8">${fb.explanation}</p>` : ''}
          </div>
        `;
      }).join('')}
      <button class="btn btn-outline mt-16" id="exam-view-ranking">${t('btn_view_ranking')}</button>
      <div id="exam-ranking-box" class="mt-16"></div>
    `;
  },

  async handleStart() {
    try {
      const data = await API.startExam(this.examId);
      this.state.attempt = { id: data.id, started_at: data.started_at, status: 'in_progress' };
      this.paint();
    } catch (err) {
      UI.toast(err.message || 'Erreur.', 'error');
    }
  },

  wireQuestionForm(content, exam, attempt) {
    content.querySelector('#exam-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleSubmit(content, exam);
    });
  },

  startTimer(exam, attempt) {
    const startedAt = new Date(attempt.started_at).getTime();
    const totalSeconds = exam.time_limit_minutes * 60;

    const tick = () => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      const remaining = Math.max(0, totalSeconds - elapsed);
      this.state.remainingSeconds = remaining;
      const el = this.content.querySelector('#exam-timer');
      if (el) {
        const mm = String(Math.floor(remaining / 60)).padStart(2, '0');
        const ss = String(remaining % 60).padStart(2, '0');
        el.textContent = `${mm}:${ss}`;
      }
      if (remaining <= 0) {
        clearInterval(this.state.timerHandle);
        this.state.timerHandle = null;
        UI.toast(I18N.current === 'fr' ? 'Temps écoulé — soumission automatique.' : 'Time is up — auto-submitting.', 'error');
        this.handleSubmit(this.content, exam);
      }
    };
    tick();
    this.state.timerHandle = setInterval(tick, 1000);
  },

  async handleSubmit(content, exam) {
    if (this.state.timerHandle) { clearInterval(this.state.timerHandle); this.state.timerHandle = null; }

    const form = content.querySelector('#exam-form');
    const answers = {};
    exam.questions.forEach(q => {
      const field = form.elements[`q-${q.id}`];
      if (!field) return;
      if (field instanceof RadioNodeList) {
        const checked = Array.from(field).find(r => r.checked);
        answers[q.id] = checked ? checked.value : '';
      } else {
        answers[q.id] = field.value || '';
      }
    });

    const btn = content.querySelector('#exam-submit-btn');
    if (btn) UI.setLoading(btn, true);
    try {
      await API.submitExam(this.examId, answers);
      await this.load();
      this.paint();
    } catch (err) {
      UI.toast(err.message || 'Erreur.', 'error');
      if (btn) UI.setLoading(btn, false, t('btn_submit_exam'));
    }
  },

  async loadRanking(content) {
    const box = content.querySelector('#exam-ranking-box');
    box.innerHTML = `<div class="boot-spinner" style="margin:10px auto;width:20px;height:20px;"></div>`;
    try {
      const data = await API.examRanking(this.examId);
      box.innerHTML = `
        <p class="text-muted text-sm">${I18N.current === 'fr' ? "Classement au sein de l'établissement" : 'Ranking within the establishment'}</p>
        <div class="card mt-8">
          ${data.ranking.map(r => `
            <div class="flex justify-between text-sm" style="padding:6px 0;border-bottom:1px solid var(--color-border);">
              <div>#${r.rank} — ${r.first_name} ${r.last_name}</div>
              <div>${r.score} / ${r.max_score}</div>
            </div>
          `).join('')}
        </div>
      `;
    } catch (err) {
      box.innerHTML = `<div class="alert alert-error">${err.message || 'Erreur.'}</div>`;
    }
  },
};
