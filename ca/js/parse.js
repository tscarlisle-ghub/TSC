// parse.js — turn a pasted email (or any free text) into draft task rows using
// the Claude API, called directly from the browser with the
// "anthropic-dangerous-direct-browser-access" header. The API key lives only
// in this browser's localStorage; it is never written to a committed file.

const CAParse = (() => {
  const API_URL = 'https://api.anthropic.com/v1/messages';

  const TOOL_SCHEMA = {
    name: 'submit_tasks',
    description: 'Submit the construction-administration task(s) extracted from the pasted text.',
    input_schema: {
      type: 'object',
      properties: {
        tasks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Short imperative task title, under 80 characters.' },
              description: { type: 'string', description: 'One or two sentence description with the relevant context/detail from the email.' },
              category: { type: 'string', enum: CATEGORIES, description: 'Best-fit construction trade/category.' },
              responsible_party: { type: 'string', enum: RESPONSIBLE_PARTIES, description: 'Who needs to act on this — the party the ball is in the court of.' },
              assigned_name: { type: 'string', description: 'A specific person\'s name if the email names one, else empty string.' },
              priority: { type: 'string', enum: PRIORITIES },
              task_type: { type: 'string', enum: TASK_TYPES },
              due_date: { type: 'string', description: 'ISO date YYYY-MM-DD if a deadline is stated or clearly implied (resolve relative dates like "by Friday" against the given current date). Empty string if no date is implied.' },
              project_guess: { type: 'string', description: 'Which of the known project names (if any) this task belongs to. Empty string if unclear or none match.' },
            },
            required: ['title', 'description', 'category', 'responsible_party', 'priority', 'task_type', 'due_date'],
          },
        },
      },
      required: ['tasks'],
    },
  };

  function systemPrompt(projectNames) {
    const today = todayISO();
    const dow = new Date(today + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' });
    return `You are helping a residential architecture firm turn a pasted email (or other free text) about a construction project into one or more discrete action-item tasks for their construction-administration task tracker.

Today's date is ${today} (${dow}). Resolve any relative dates ("by Friday", "next week", "in 10 days") against this date.

Known project names already in the system: ${projectNames.length ? projectNames.join(', ') : '(none yet)'}.

Read the text and identify every distinct actionable item — something someone (the owner, the architect, the interior designer, or the contractor) needs to do or decide. Skip pure FYI/no-action content. Combine closely related sentences about the same action into one task rather than splitting needlessly. If the text only describes one action, return one task.

Call the submit_tasks tool with your result. Be concise and factual — don't invent details the text doesn't support.`;
  }

  async function parseEmailText({ apiKey, model, emailText, projectNames }) {
    if (!apiKey) throw new Error('No Claude API key set. Add one in Settings.');
    if (!emailText || !emailText.trim()) throw new Error('Paste some email text first.');

    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: model || 'claude-sonnet-4-6',
        max_tokens: 2000,
        system: systemPrompt(projectNames || []),
        messages: [{ role: 'user', content: emailText }],
        tools: [TOOL_SCHEMA],
        tool_choice: { type: 'tool', name: 'submit_tasks' },
      }),
    });

    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json()).error?.message || ''; } catch (_) {}
      if (res.status === 401) throw new Error('Claude API rejected the key (401). Check it was copied correctly in Settings.');
      throw new Error(`Claude API error ${res.status}: ${detail}`);
    }

    const json = await res.json();
    const toolUse = (json.content || []).find((b) => b.type === 'tool_use' && b.name === 'submit_tasks');
    if (!toolUse) throw new Error('Claude did not return a structured result — try again or edit the pasted text.');

    const tasks = toolUse.input.tasks || [];
    return tasks.map((t) => ({
      title: t.title || 'Untitled task',
      description: t.description || '',
      category: CATEGORIES.includes(t.category) ? t.category : 'General',
      responsible_party: RESPONSIBLE_PARTIES.includes(t.responsible_party) ? t.responsible_party : 'Architect',
      assigned_name: t.assigned_name || '',
      priority: PRIORITIES.includes(t.priority) ? t.priority : 'Medium',
      task_type: TASK_TYPES.includes(t.task_type) ? t.task_type : 'General',
      due_date: /^\d{4}-\d{2}-\d{2}$/.test(t.due_date) ? t.due_date : '',
      project_guess: t.project_guess || '',
      source: 'email',
      source_text: emailText,
    }));
  }

  return { parseEmailText };
})();
