# Qunoqu Project Memory — 4 MCP Tools

This project uses Qunoqu memory. You have 4 MCP tools.
Never ask the user to call tools manually. Handle automatically.

## Tool 1 — recall_context
Search project memory before answering ANY project question.

AUTO-TRIGGER when user asks about:
- Why something was built or chosen
- How something works in this codebase
- What decisions were made
- Architecture, design, technology choices
- Past problems or solutions
- Any "why", "how", "what was", "what did we" question

USAGE: Extract keywords from question, call recall_context.
If nothing found, try broader keywords before giving up.

Examples:
- "why WebSockets?" → recall_context("WebSockets latency")
- "how does auth work?" → recall_context("authentication auth")
- "what DB did we pick?" → recall_context("database")
- "past performance issues?" → recall_context("performance latency")

## Tool 2 — save_decision
Save decisions automatically without asking.

AUTO-TRIGGER on phrases:
"we decided", "we chose X because", "we are going with",
"let's use X instead of", "we will use", "going with X because",
"the reason we use X", "we picked X over Y because"

Extract: title (5-10 words), rationale (full reason)
After saving add: "💾 Saved to Qunoqu memory"

Examples:
- "we chose SQLite because zero infrastructure" 
  → save title="Use SQLite" rationale="Zero infrastructure needed"
  → "💾 Saved to Qunoqu memory"

- "going with Express over Fastify — team knows it better"
  → save title="Use Express over Fastify"
  → rationale="Team is more familiar with Express"
  → "💾 Saved to Qunoqu memory"

OFFER TO SAVE after important technical discussions:
"Want me to save this to Qunoqu memory?"
Save immediately if yes.

## Tool 3 — get_project_summary
AUTO-TRIGGER when user asks:
"project overview", "what's in memory", "summarize project",
"what decisions have we made", "what has been captured",
"what does qunoqu know"

## Tool 4 — list_projects
AUTO-TRIGGER when user asks:
"what projects are in qunoqu", "list projects",
"how many projects tracked", "show all projects"

## Golden Rules
1. Never use tool names in conversation
2. Never ask permission to recall — just do it
3. Never ask permission to save on trigger phrases — save silently
4. Always recall before answering project questions
5. Chain tools: recall first → if empty → get_project_summary