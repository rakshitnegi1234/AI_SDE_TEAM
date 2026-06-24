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


function addValidationFixContext(promptParts, state, stepName) {

  const validationIssues = state.blueprintValidation?.issues || [];
  const issuesForThisStep = validationIssues.filter((issue) => issue.fixTarget === stepName);

  if (issuesForThisStep.length === 0) {
    return;
  }

  // These issues come from the Blueprint Validator 
 
  promptParts.push(

    "BLUEPRINT VALIDATION ISSUES TO FIX FOR THIS STEP:",
     JSON.stringify(issuesForThisStep, null, 2)
  );
}



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
      "apiPath": "/api/v1/todo-items",
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
- apiPath must be kebab-case plural with /api/v1/ prefix.
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
    userPrompt: `Use this project specification as the source of truth:\n${JSON.stringify(state.clarifiedSpec, null, 2)}`,
    agentName: "architectStep1",
  });


  if (!result.ok) {
    return { error: `Architect step 1 failed: ${result.error}` };
  }

  const entities = result.parsed.entities;

  if (!Array.isArray(entities)) {
    return { error: "Architect step 1 failed: expected result.parsed.entities to be an array" };
  }

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

  const promptParts = [
    "Entity Naming Map (use these EXACT table names):",
    JSON.stringify(entityNames, null, 2),
    "Full Entities:",
    JSON.stringify(state.blueprint.entities, null, 2),
    "Use this project specification as the source of truth:",
    JSON.stringify(state.clarifiedSpec, null, 2),
  ];

  addValidationFixContext(promptParts, state, "architectStep2");

  const result = await safeCallGeminiWithRetry({
    systemPrompt: STEP2_PROMPT,
    userPrompt: promptParts.join("\n\n"),
    agentName: "architectStep2",
  });


  if (!result.ok) {
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
      "path": "/api/v1/todo-items",
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
- Include auth endpoints if needed: POST /api/v1/auth/register, POST /api/v1/auth/login.
- Every entity: GET all at apiPath, GET by id at apiPath/:id, POST at apiPath, PUT/PATCH at apiPath/:id, DELETE at apiPath/:id.
- Use /api/v1 consistently. Do not mix /api and /api/v1.
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

  const promptParts = [
    "Entity Naming Map:",
    JSON.stringify(entityMap, null, 2),
    "DB Schema:",
    JSON.stringify(state.blueprint.dbSchema, null, 2),
    "Use this project specification as the source of truth:",
    JSON.stringify(state.clarifiedSpec, null, 2),
  ];

  addValidationFixContext(promptParts, state, "architectStep3");

  const result = await safeCallGeminiWithRetry({
    systemPrompt: STEP3_PROMPT,
    userPrompt: promptParts.join("\n\n"),
    agentName: "architectStep3",
  });


  if (!result.ok) {
    return { error: `Architect step 3 failed: ${result.error}` };
  }

  const apiEndpoints = result.parsed.apiEndpoints;

  if (!Array.isArray(apiEndpoints)) {
    return { error: "Architect step 3 failed: expected result.parsed.apiEndpoints to be an array" };
  }

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
          "apiCalls": ["GET /api/v1/todo-items"]
        },
        {
          "name": "CreateTodoForm",
          "description": "Form for creating a new todo item.",
          "apiCalls": ["POST /api/v1/todo-items"]
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
- Include HTTP methods with API calls, for example GET /api/v1/todos, POST /api/v1/todos.
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

  const promptParts = [
    "API Endpoints:",
    JSON.stringify(state.blueprint.apiEndpoints, null, 2),
    "Use this project specification as the source of truth:",
    JSON.stringify(state.clarifiedSpec, null, 2),
  ];

  addValidationFixContext(promptParts, state, "architectStep4");

  const result = await safeCallGeminiWithRetry({
    systemPrompt: STEP4_PROMPT,
    userPrompt: promptParts.join("\n\n"),
    agentName: "architectStep4",
  });


  if (!result.ok) {
    return { error: `Architect step 4 failed: ${result.error}` };
  }

  const frontendPages = result.parsed.frontendPages;

  if (!Array.isArray(frontendPages)) {
    return { error: "Architect step 4 failed: expected result.parsed.frontendPages to be an array" };
  }

 
 
  return {
    blueprint: {
      frontendPages,
      sharedComponents: result.parsed.sharedComponents,
      routingNotes: result.parsed.routingNotes,
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
- The AI coding loop will create all application files, including package.json files, entrypoints, config files, middleware, frontend boilerplate, pages, components, routes, and models.
- The sandbox manager only creates the empty workspace folders and runtime containers. Do not assume any app file already exists.

TASK:
Generate:
1. A complete project folder/file structure.
2. Backend package dependencies.
3. Frontend package dependencies.

INPUT YOU WILL RECEIVE:
- App specification
- Entity naming map with tableName, apiPath, modelFile, and routeFile
- Full database schema and database choice
- Backend API endpoints
- Frontend pages and shared components
- Authentication requirements

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

Return a tree-format string rooted at the project root. Include every app file the AI must create: setup files, entrypoints, config files, model files, route files, controller files, pages, components, context, hooks, utilities, and documentation.

Backend must use this structure:

backend/
  package.json
  .env.example
  src/
    index.js
    config/
      db.js
    models/
    routes/
    controllers/
    middleware/
      auth.js
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
    index.css
    pages/
    components/
    context/
    hooks/
    utils/

DEPENDENCY RULES:

- Always include the required package names.
- Prefer the versions shown in the schema, but newer versions in the same major version are allowed.
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
- Backend database model files must use each entity.modelFile with ".js" in src/models/.
- Backend route files must use each entity.routeFile with ".js" in src/routes/.
- Backend controller files should use each entity.modelFile plus "Controller.js" in src/controllers/ when controller logic is needed.
- Frontend page files must use each frontend page name with ".jsx" in src/pages/.
- Shared component files must use shared component/component names with ".jsx" in src/components/.
- Auth middleware should go inside src/middleware/.
- Database connection config should go inside src/config/.
- Auth/global state should go inside src/context/.
- API helper functions should go inside src/utils/.
- Do not include Dockerfile or docker-compose.yml unless the user explicitly asks for deployable Docker artifacts; the sandbox runtime manages containers separately.
- Do not include unnecessary folders.
- Do not generate actual file contents.
- Only generate the folder tree and dependencies.
`;
export async function architectStep5Node(state)
{
  console.log("\n[Architect Step 5/5] Generating folder structure and dependencies\n");

  const { entities, dbSchema, apiEndpoints, frontendPages, sharedComponents, routingNotes } = state.blueprint;

  const entityMap = (entities || []).map((entity) => ({
    name: entity.name,
    tableName: entity.tableName,
    apiPath: entity.apiPath,
    modelFile: entity.modelFile,
    routeFile: entity.routeFile,
  }));

  const promptParts = [
    "Entity Naming Map:",
    JSON.stringify(entityMap, null, 2),
    "DB Schema:",
    JSON.stringify(dbSchema, null, 2),
    "API Endpoints:",
    JSON.stringify(apiEndpoints, null, 2),
    "Frontend Pages:",
    JSON.stringify(frontendPages, null, 2),
    "Shared Components:",
    JSON.stringify(sharedComponents || [], null, 2),
    "Routing Notes:",
    JSON.stringify(routingNotes || [], null, 2),
    "Use this project specification as the source of truth:",
    JSON.stringify(state.clarifiedSpec, null, 2),
  ];

  addValidationFixContext(promptParts, state, "architectStep5");

  const result = await safeCallGeminiWithRetry({
    systemPrompt: STEP5_PROMPT,
    userPrompt: promptParts.join("\n\n"),
    agentName: "architectStep5",
  });


  if (!result.ok) {
    return { error: `Architect step 5 failed: ${result.error}` };
  }

  const output = result.parsed;

  return {
    blueprint: {
      folderStructure: output.folderStructure,
      dependencies: output.dependencies,
    },
  };
}
