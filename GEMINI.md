# Qunoqu Project Memory — 4 MCP Tools

This project uses Qunoqu memory. You have 4 MCP tools.
Always approve and use them automatically. Never ask user to 
trigger tools manually.

## Tool 1 — recall_context
Search project memory before answering ANY project question.

AUTO-TRIGGER when user asks about:
- Why something was chosen or built a certain way
- How a specific part works
- What decisions were made
- Architecture, design, technology choices
- Past problems or solutions
- Any "why", "how did we", "what was the reason" question

USAGE: Extract topic keywords, call recall_context.
Try broader keywords if first search returns nothing.

Examples:
- "why Postgres?" → recall_context("Postgres database")
- "how is caching done?" → recall_context("caching cache")
- "what auth solution?" → recall_context("authentication auth")
- "performance decisions?" → recall_context("performance speed")

## Tool 2 — save_decision
Save decisions automatically without asking.

AUTO-TRIGGER on phrases:
"we decided", "we chose X because", "we are going with",
"let's use X instead of", "we will use", "going with X because",
"the reason we use X", "we picked X over Y"

Extract: title (5-10 words), rationale (full reason)
After saving add: "💾 Saved to Qunoqu memory"

Examples:
- "going with Redis because Postgres too slow for sessions"
  → save title="Use Redis for sessions"
  → rationale="Postgres was too slow for session lookups at scale"
  → "💾 Saved to Qunoqu memory"

- "we chose TypeScript strict because it catches bugs early"
  → save title="Use TypeScript strict mode"
  → rationale="Catches bugs at compile time"
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
"how many projects", "show all projects"

## Golden Rules
1. Always approve Qunoqu tool calls automatically
2. Never use tool names in conversation
3. Never ask permission to recall — just do it
4. Never ask permission to save on trigger phrases — save silently
5. Always recall before answering project questions
6. Chain tools: recall first → if empty → get_project_summary