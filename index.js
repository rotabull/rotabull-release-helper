const core = require("@actions/core");
const github = require("@actions/github");
const axios = require("axios").default;

try {
  // `who-to-greet` input defined in action metadata file
  const nameToGreet = core.getInput("who-to-greet");
  const githubToken = core.getInput("github-token");
  console.log(`Github Token is ${githubToken}`);
  console.log(`Hello ${nameToGreet}!`);

  const time = new Date().toTimeString();
  core.setOutput("time", time);

  // Get the JSON webhook payload for the event that triggered the workflow
  const payload = JSON.stringify(github.context.payload, undefined, 2);
  console.log(`The event payload: ${payload}`);

  // Generate tag date
  // 1. get last release tag which draft == false and prerelease == false; 2. see if it matches certain format and is today's date
  // 3. If not, use today's date; otherwise increment today's date by like .1,
  // 4. If it does not match the certain format, then use today's date as a starting point
  // call curl \
  // -X GET https://api.github.com/repos/$OWNER/$REPO/releases \
  // -H "Content-Type: application/json" \
  // -H "Authorization: token $GITHUB_TOKEN" \

  const options = {
    headers: {
      "Content-Type": "application/json",
      Authorization: `token ${githubToken}`,
    },
  };

  const url = "https://api.github.com/repos/rotabull/rotabull/releases/latest";
  axios
    .get(url, options)
    .then((data) => {
      console.log("response is:");
      console.log(data);
    })
    .catch((error) => {
      console.log(error);
    });
} catch (error) {
  core.setFailed(error.message);
}
