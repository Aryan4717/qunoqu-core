const { MetadataStore, KnowledgeGraph } = require('./packages/core/dist/index.js');

const db = new MetadataStore();
const kg = new KnowledgeGraph();

const pid = db.insertProject({
  name: 'qunoqu-core',
  root_path: '/Users/aryan/Desktop/qunoqu-core'
});

db.insertContextItem({
  project_id: pid,
  type: 'decision',
  content: 'We chose WebSockets because polling caused 500ms latency',
  file_path: 'packages/core/src/TerminalCapture.ts',
  tags: ['websockets']
});

db.insertContextItem({
  project_id: pid,
  type: 'decision',
  content: 'We use SQLite because it requires zero infrastructure and works offline',
  file_path: 'packages/core/src/MetadataStore.ts',
  tags: ['sqlite']
});

db.insertDecision({
  project_id: pid,
  title: 'Use MCP for AI tool integration',
  rationale: 'MCP is the standard protocol for Claude and Cursor tool integration'
});

db.close();
console.log('Seeded! Project ID:', pid);
