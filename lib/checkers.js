const Github = require("./github");
const Clubhouse = require("./clubhouse");

module.exports = {
  async clubhouseAcceptance(prNumber, githubToken, clubhouseToken) {
    const github = new Github(githubToken);
    const clubhouse = new Clubhouse(clubhouseToken);

    const { data: pr } = await github.getPr(prNumber);

    const sha = github.getPrSha(pr);
    const storyID = clubhouse.extractStoryIdFromPrTitle(pr.title);

    if (!storyID) {
      await github.addPrStatus({ description: "Can't find Clubhouse story ID in PR title", state: "failure", sha });

      return null;
    }

    const story = await clubhouse.getStory(storyID);

    if (!clubhouse.storyHasAcceptedLabel(story)) {
      await github.addPrStatus({ description: "Not accepted yet", state: "failure", sha });
    } else {
      await github.addPrStatus({ description: "Good, accepted", state: "success", sha });
    }

    return null;
  },
};
