import { safeCallGeminiWithRetry } from "../utils/gemini.js";

const NAMING_RULES = `

STRICT NAMING CONVENTION (you MUST follow this):

- Table names: snake_case + plural
  Example: "users", "todo_items", "categories"

- DB field names: snake_case
  Example: "created_at", "password_hash", "user_id"

- API paths: /api/v1/ + kebab-case + plural resource name
  Example: "/api/v1/users", "/api/v1/todo-items", "/api/v1/categories"

- API versioning:
  Use "/api/v1" for the first version.
  Use "/api/v2" only when creating a breaking API change in the future.
  Do not randomly mix v1 and v2 in the same blueprint.

- relatedTable field:
  ALWAYS use a single table name.
  NEVER use comma-separated table names.
  Example: "users", not "users, orders"

- Foreign key format:
  "table_name(field)"
  Example: "users(id)", "restaurants(id)"
`;

// STEP 1: Identify Entities & Relationships + Naming Map


const STEP1_PROMPT = `You are the Architect Agent in an AI software development team.

ROLE:
You are a senior software architect.

GOAL:
From the user's clarified requirement, identify all core domain entities, their relationships, and generate standard names for database tables, API paths, model files, and route files.

${NAMING_RULES}

OUTPUT FORMAT:
Return ONLY valid JSON. Do not include markdown, comments, or explanation.

{
  "entities": [
    {
      "name": "TodoItem",
      "tableName": "todo_items",
      "apiPath": "/api/todo-items",
      "modelFile": "todoItem",
      "routeFile": "todoItemRoutes",
      "description": "A task or todo entry",
      "relationships": [
        {
          "target": "User",
          "type": "many-to-one",
          "foreignKey": "user_id",
          "description": "Each todo belongs to a user"
        }
      ]
    }
  ]
}

RULES:
- Always include a "User" entity if authentication is required.
- Generate tableName, apiPath, modelFile, and routeFile for every entity.
- tableName must be snake_case plural.
- apiPath must be kebab-case plural with /api/ prefix.
- modelFile must be camelCase with no extension.
- routeFile must be camelCase with no extension and should end with "Routes".
- Entity name must be PascalCase singular.
- relationship.type must be one of: "one-to-one", "one-to-many", "many-to-one", "many-to-many".
- foreignKey must be snake_case.
- If an entity has no relationships, use an empty array: [].
- Do not invent unnecessary entities. Include only entities required by the clarified requirement.`;


export async function architectStep1Node(state) 
{
  console.log("\n[Architect Step 1/5] Identifying entities & naming map\n");

  const result = await safeCallGeminiWithRetry({
    systemPrompt: STEP1_PROMPT,
    userPrompt: `Project Specification:\n${JSON.stringify(state.clarifiedSpec, null, 2)}`,
    agentName: "architectStep1",
  });


  if (!result.ok) {
    console.error(`Architect step 1 failed: ${result.error}`);
    return { error:`Architect step 1 failed: ${result.error}` };
  }

  const entities = result.parsed.entities || result.parsed;
  console.log(`Found ${entities.length} entities:`);
  entities.forEach(e => console.log(`   • ${e.name} → table: ${e.tableName}, api: ${e.apiPath}`));

  return {
    blueprint: { entities },
  };
}


// STEP 2: Design Database Schema


const STEP2_PROMPT = `You are the Architect Agent designing the database schema.

${NAMING_RULES}

CRITICAL: Use the EXACT table names from the entity naming map provided. Do NOT rename tables.

OUTPUT FORMAT (strict JSON):
{
  "databaseType": "PostgreSQL" | "MongoDB",
  "databaseReason": "Why this DB (1 line)",
  "tables": [
    {
      "name": "todo_items",
      "description": "Stores todo entries",
      "fields": [
        { "name": "id", "type": "UUID DEFAULT gen_random_uuid()", "constraints": ["PRIMARY KEY"], "description": "Unique ID" },
        { "name": "title", "type": "VARCHAR(255)", "constraints": ["NOT NULL"], "description": "Todo title" },
        { "name": "user_id", "type": "UUID", "constraints": ["NOT NULL"], "description": "Owner" },
        { "name": "created_at", "type": "TIMESTAMP", "constraints": ["DEFAULT NOW()"], "description": "Created time" },
        { "name": "updated_at", "type": "TIMESTAMP", "constraints": ["DEFAULT NOW()"], "description": "Updated time" }
      ],
      "foreignKeys": [
        { "field": "user_id", "references": "users(id)", "onDelete": "CASCADE" }
      ],
      "indexes": ["user_id"]
    }
  ]
}

RULES:
- Every table MUST have "id" (UUID with gen_random_uuid()), "created_at", "updated_at".
- Use snake_case for ALL table and field names.
- Be SPECIFIC with types — VARCHAR(255), not just "string".
- If auth: users table needs password_hash (NEVER plain passwords).
- Add indexes on foreign keys.`;

export async function architectStep2Node(state)
{
  console.log("\n[Architect Step 2/5] Designing database schema\n");

  const entityNames = (state.blueprint.entities || []).map((entity) => ({
    name: entity.name,
    tableName: entity.tableName,
  }));

  const validationIssues = state.blueprintValidation?.issues || [];

  const promptParts = [
    "Entity Naming Map (use these EXACT table names):",
    JSON.stringify(entityNames, null, 2),
    "Full Entities:",
    JSON.stringify(state.blueprint.entities, null, 2),
    "Spec:",
    JSON.stringify(state.clarifiedSpec, null, 2),
  ];

  if (validationIssues.length > 0) {
    promptParts.push(
      "PREVIOUS VALIDATION ISSUES TO FIX:",
      JSON.stringify(validationIssues, null, 2)
    );
  }

  const result = await safeCallGeminiWithRetry({
    systemPrompt: STEP2_PROMPT,
    userPrompt: promptParts.join("\n\n"),
    agentName: "architectStep2",
  });


  if (!result.ok) {
    console.error(`Architect step 2 failed: ${result.error}`);
    return { error: `Architect step 2 failed: ${result.error}` };
  }

  return {
    blueprint: { dbSchema: result.parsed },
  };
}




// STEP 3: Design API Endpoints


const STEP3_PROMPT = `You are the Architect Agent designing REST API endpoints.

${NAMING_RULES}

CRITICAL: 
- Use the EXACT apiPath from the entity naming map.
- "relatedTable" must be a SINGLE table name, never comma-separated.

OUTPUT FORMAT (strict JSON):
{
  "apiEndpoints": [
    {
      "method": "GET",
      "path": "/api/todo-items",
      "description": "Get all todos for current user",
      "requiresAuth": true,
      "roleAccess": ["user"],
      "requestBody": {},
      "responseBody": { "todos": "array of todo objects" },
      "relatedTable": "todo_items"
    }
  ]
}

RULES:
- REST conventions: GET=read, POST=create, PUT/PATCH=update, DELETE=delete.
- Include auth endpoints if needed: POST /api/auth/register, POST /api/auth/login.
- Every entity: GET all, GET by id, POST, PUT/PATCH, DELETE.
- Pagination on GET-all (page, limit query params).
- relatedTable = the PRIMARY table this endpoint queries. ONE table only.`;

export async function architectStep3Node(state)
{
  console.log("\n[Architect Step 3/5] Designing API endpoints\n");

  const entityMap = (state.blueprint.entities || []).map((entity) => ({
    name: entity.name,
    tableName: entity.tableName,
    apiPath: entity.apiPath,
  }));

  const validationIssues = state.blueprintValidation?.issues || [];

  const promptParts = [
    "Entity Naming Map:",
    JSON.stringify(entityMap, null, 2),
    "DB Schema:",
    JSON.stringify(state.blueprint.dbSchema, null, 2),
    "Spec:",
    JSON.stringify(state.clarifiedSpec, null, 2),
  ];

  if (validationIssues.length > 0) {
    promptParts.push(
      "PREVIOUS VALIDATION ISSUES TO FIX:",
      JSON.stringify(validationIssues, null, 2)
    );
  }

  const result = await safeCallGeminiWithRetry({
    systemPrompt: STEP3_PROMPT,
    userPrompt: promptParts.join("\n\n"),
    agentName: "architectStep3",
  });


  if (!result.ok) {
    console.error(`Architect step 3 failed: ${result.error}`);
    return { error: `Architect step 3 failed: ${result.error}` };
  }

  const endpoints = result.parsed.apiEndpoints || result.parsed;
  const apiEndpoints = Array.isArray(endpoints) ? endpoints : [];

  console.log(`Designed ${apiEndpoints.length} API endpoints`);

  return {
    blueprint: { apiEndpoints },
  };
}


// STEP 4: Design Frontend Pages


const STEP4_PROMPT = `
You are the Architect Agent responsible for designing the frontend page structure for a web application.

TECH STACK:
- React with Vite
- React Router
- useState and useContext for state management
- Tailwind CSS for styling

TASK:
Generate the frontend pages, routes, layouts, and page-level components required for the application.

INPUT YOU WILL RECEIVE:
- App specification
- Backend API endpoints
- Authentication requirements
- Entity/data model information

OUTPUT FORMAT:
Return ONLY valid JSON. Do not include markdown, comments, explanations, or extra text.

JSON SCHEMA:
{
  "frontendPages": [
    {
      "name": "DashboardPage",
      "route": "/dashboard",
      "description": "Main authenticated page showing the user's todos with add, edit, delete, and status update actions.",
      "requiresAuth": true,
      "layout": "AppLayout",
      "components": [
        {
          "name": "TodoList",
          "description": "Displays todo items in a list or grid.",
          "apiCalls": ["GET /api/todo-items"]
        },
        {
          "name": "CreateTodoForm",
          "description": "Form for creating a new todo item.",
          "apiCalls": ["POST /api/todo-items"]
        }
      ]
    }
  ],
  "sharedComponents": [
    {
      "name": "AppLayout",
      "description": "Main layout wrapper with navbar, protected content area, and logout action.",
      "usedBy": ["DashboardPage"]
    }
  ],
  "routingNotes": [
    "Protected routes should redirect unauthenticated users to /login.",
    "Authenticated users should be redirected away from /login and /register to /dashboard."
  ]
}

RULES:
- Use descriptive page names ending with Page, for example DashboardPage, LoginPage, RegisterPage.
- Use descriptive component names, for example TodoList, TodoForm, Navbar, AppLayout.
- Include LoginPage and RegisterPage if authentication is required.
- Include at least one layout component such as AppLayout, AuthLayout, or PublicLayout.
- Every page that reads or mutates backend data must list the exact API calls it uses.
- API calls must use the EXACT endpoint paths provided in the input.
- Include HTTP methods with API calls, for example GET /api/todos, POST /api/todos.
- Do not invent API endpoints that were not provided.
- Use clean, user-friendly routes such as /dashboard, /login, /register, /todos.
- Do not use vague routes such as /page1, /screen, or /home unless they are clearly required.
- Keep pages frontend-focused. Do not design backend logic here.
- Do not include database tables, backend services, controllers, or schema design.
- Avoid over-engineering. Generate only pages and components needed by the specification.
`;

export async function architectStep4Node(state)
{
  console.log("\n[Architect Step 4/5] Designing frontend pages\n");

  const validationIssues = state.blueprintValidation?.issues || [];

  const promptParts = [
    "API Endpoints:",
    JSON.stringify(state.blueprint.apiEndpoints, null, 2),
    "Spec:",
    JSON.stringify(state.clarifiedSpec, null, 2),
  ];

  if (validationIssues.length > 0) {
    promptParts.push(
      "PREVIOUS VALIDATION ISSUES TO FIX:",
      JSON.stringify(validationIssues, null, 2)
    );
  }

  const result = await safeCallGeminiWithRetry({
    systemPrompt: STEP4_PROMPT,
    userPrompt: promptParts.join("\n\n"),
    agentName: "architectStep4",
  });


  if (!result.ok) {
    console.error(`Architect step 4 failed: ${result.error}`);
    return { error: `Architect step 4 failed: ${result.error}` };
  }

  const frontendPages = Array.isArray(result.parsed.frontendPages)
    ? result.parsed.frontendPages
    : Array.isArray(result.parsed)
      ? result.parsed
      : [];

  console.log(`Designed ${frontendPages.length} pages`);

  return {
    blueprint: {
      frontendPages,
      sharedComponents: result.parsed.sharedComponents || [],
      routingNotes: result.parsed.routingNotes || [],
    },
  };
}

// STEP 5: Folder Structure + Dependencies


const STEP5_PROMPT = `
You are the Architect Agent generating the complete project folder structure and package dependencies.

TECH STACK:
- Backend: Express.js
- Frontend: React with Vite
- Architecture: Monorepo with /backend and /frontend folders

TASK:
Generate:
1. A complete project folder/file structure.
2. Backend package dependencies.
3. Frontend package dependencies.

INPUT YOU WILL RECEIVE:
- App specification
- Database choice
- Backend API endpoints
- Frontend pages
- Authentication requirements
- Entity/model information

OUTPUT FORMAT:
Return ONLY valid JSON. Do not include markdown, comments, explanations, or extra text.

JSON SCHEMA:
{
  "folderStructure": "tree-format string showing every required folder and file",
  "dependencies": {
    "backend": {
      "name": "backend",
      "dependencies": {
        "express": "^4.18.2",
        "cors": "^2.8.5",
        "dotenv": "^16.4.7",
        "bcryptjs": "^2.4.3",
        "jsonwebtoken": "^9.0.2",
        "uuid": "^9.0.0"
      },
      "devDependencies": {
        "nodemon": "^3.0.0"
      }
    },
    "frontend": {
      "name": "frontend",
      "dependencies": {
        "react": "^18.2.0",
        "react-dom": "^18.2.0",
        "react-router-dom": "^6.20.0",
        "axios": "^1.6.0"
      },
      "devDependencies": {
        "vite": "^5.0.0",
        "@vitejs/plugin-react": "^4.2.0",
        "tailwindcss": "^3.4.0",
        "postcss": "^8.4.0",
        "autoprefixer": "^10.4.0"
      }
    }
  }
}

FOLDER STRUCTURE RULES:

Backend must use this structure:
backend/
  package.json
  .env.example
  src/
    server.js
    app.js
    config/
    models/
    routes/
    controllers/
    middleware/
    utils/

Frontend must use this structure:
frontend/
  package.json
  index.html
  vite.config.js
  tailwind.config.js
  postcss.config.js
  src/
    main.jsx
    App.jsx
    pages/
    components/
    context/
    hooks/
    utils/

DEPENDENCY RULES:
- Use EXACT version numbers from the schema.
- Always include backend dependencies:
  - express
  - cors
  - dotenv
  - bcryptjs
  - jsonwebtoken
  - uuid
- Include pg at version "^8.11.0" only if the selected database is PostgreSQL.
- Include mongoose at version "^8.8.0" only if the selected database is MongoDB.
- Never include both pg and mongoose unless the specification explicitly requires both databases.
- Always include frontend dependencies:
  - react
  - react-dom
  - react-router-dom
  - axios
- Always include frontend devDependencies:
  - vite
  - @vitejs/plugin-react
  - tailwindcss
  - postcss
  - autoprefixer

PROJECT STRUCTURE RULES:
- Folder/file names must match the generated backend entities, API routes, and frontend pages.
- Backend routes should go inside src/routes/.
- Backend controllers should go inside src/controllers/.
- Backend database models should go inside src/models/.
- Auth middleware should go inside src/middleware/.
- Database connection config should go inside src/config/.
- Frontend pages should go inside src/pages/.
- Reusable frontend UI components should go inside src/components/.
- Auth/global state should go inside src/context/.
- API helper functions should go inside src/utils/.
- Do not include unnecessary folders.
- Do not generate actual file contents.
- Only generate the folder tree and dependencies.
`;

export async function architectStep5Node(state)
{
  console.log("\n[Architect Step 5/5] Generating folder structure and dependencies\n");

  const { dbSchema, apiEndpoints, frontendPages } = state.blueprint;
  const promptParts = [
    `DB: ${dbSchema?.databaseType} (${dbSchema?.tables?.length} tables)`,
    `APIs: ${apiEndpoints?.length} endpoints`,
    `Pages: ${frontendPages?.length} pages`,
    "Spec:",
    JSON.stringify(state.clarifiedSpec, null, 2),
  ];

  const result = await safeCallGeminiWithRetry({
    systemPrompt: STEP5_PROMPT,
    userPrompt: promptParts.join("\n\n"),
    agentName: "architectStep5",
  });


  if (!result.ok) {
    console.error(`Architect step 5 failed: ${result.error}`);
    return { error: `Architect step 5 failed: ${result.error}` };
  }

  const output = result.parsed;
  const backendDependencies = output.dependencies?.backend?.dependencies || {};
  const frontendDependencies = output.dependencies?.frontend?.dependencies || {};

  console.log("Folder structure generated");
  console.log(`Backend deps: ${Object.keys(backendDependencies).length}`);
  console.log(`Frontend deps: ${Object.keys(frontendDependencies).length}`);

  return {
    blueprint: {
      folderStructure: output.folderStructure,
      dependencies: output.dependencies,
    },
  };
}
