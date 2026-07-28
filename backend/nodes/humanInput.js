import * as readline from "readline/promises";

export async function humanInputNode(state) {
  const clarificationQuestions = state.pmQuestions;

  if (clarificationQuestions.length === 0) {
    return {
      pmStatus: "idle",
    };
  }

  printClarificationQuestions(clarificationQuestions);

  const userAnswer = await promptUser("\nYour answers: ");

  return {
    pmStatus: "idle",
    pmConversation: [
      {
        role: "user",
        answers: userAnswer,
      },
    ],
  };
}

function printClarificationQuestions(questions) {
  console.log("\nPM Agent needs clarification:\n");

    questions.forEach((question, index) => {
    console.log(`${index + 1}. ${question}`);
  });
}

async function promptUser(message) {
  const readlineInterface = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answer = await readlineInterface.question(message);
  readlineInterface.close();
  return answer.trim();
}
