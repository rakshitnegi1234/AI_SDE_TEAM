import * as readline from "readline";

export async function humanInputNode(state) {
  const questions = state.pmQuestions || [];

  if (questions.length === 0) {
    return {
      pmStatus: "idle",
    };
  }

  console.log("\nPM Agent needs clarification:\n");

  questions.forEach((question, index) => {
    console.log(`${index + 1}. ${question}`);
  });

  const answers = await askUser("\nYour answers: ");

  return {
    pmStatus: "idle",
    pmConversation: [{ role: "user", answers }],
  };
}

function askUser(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}
  
