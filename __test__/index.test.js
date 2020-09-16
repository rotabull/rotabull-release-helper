const moment = require("moment");
const axios = require("axios");

const main = require("../index.js");

describe("index.js", () => {
  describe("promoteOnHeroku", () => {
    test("it should filter ", () => {
      const response = {};
      const options = {};
      jest.mock("axios");
      axios.post = jest.fn();
      jest.fn().mockImplementationOnce(() => Promise.resolve(response));
      main.promoteOnHeroku();
      expect(axios.post).toHaveBeenCalledWith(
        "https://api.heroku.com/pipeline-promotions",
        options
      );
    });
  });
  describe("checkPromotionStatus", () => {
    test("it should filter ", () => {});
  });
  describe("githubRelease", () => {
    test("it should filter ", () => {
      jest.mock("axios");
      axios.get = jest.fn();
      const response = {
        data: {
          status: "completed",
        },
        id: "12345",
        body: "123456Body",
        tag_name: "tag_name",
      };
      const options = {};
      jest.fn().mockImplementationOnce(() => Promise.resolve(response));

      expect(main.githubRelease()).resolves.toEqual(response);

      expect(axios.get).toHaveBeenCalledWith(
        "https://api.github.com/repos/rotabull/rotabull/releases/latest",
        options
      );
    });
  });

  describe("composeReleaseBody", () => {
    test("titles collection is empty", () => {
      const collection = {
        Feature: [],
        Bugfix: [],
        Chore: [],
      };
      const releaseBody = main.composeReleaseBody(collection);
      expect(releaseBody).toBe("");
    });
    test("titles collection contains at least 1 element ", () => {
      const collection = {
        Feature: ["Story 1 [ch2222](www.google.com)"],
        Bugfix: ["Story 3 [ch1234](www.google3.com)"],
        Chore: ["Story 2 [ch3333](www.google2.com)"],
      };
      const releaseBody = main.composeReleaseBody(collection);
      console.log(releaseBody);
      expect(releaseBody).toBe(
        "## What's Changed\r\n\r\n### Features -- ⭐️\r\n" +
          "\r\n* Story 1 [ch2222](www.google.com)\r\n" +
          "\r\n### Bugfixes -- 🐞\r\n" +
          "\r\n* Story 3 [ch1234](www.google3.com)\r\n" +
          "\r\n### Chores -- ⚙\r\n" +
          "\r\n* Story 2 [ch3333](www.google2.com)\r\n"
      );
    });
  });

  describe("extractClubhouseNumberFromPRBody", () => {
    test("extracts clubhouse number from body", () => {
      const mockBody =
        'Add the filename of the attachment in the "download" attribute so it can be properly displayed/download when clicking on it\r\n' +
        "\r\n" +
        "---\r\n" +
        "\r\n" +
        "## Clubhouse Link\r\n" +
        "\r\n" +
        "[Clubhouse Story](https://app.clubhouse.io/rotabull/story/3681)\r\n" +
        "\r\n" +
        "### Tests\r\n" +
        "\r\n" +
        "- [x] New functionality covered — even for the smallest changes, there should be a test that fails when the new code is removed\r\n" +
        "\r\n" +
        "### Manual testing\r\n" +
        "\r\n" +
        "- [x] Feature works with fake data on localhost\r\n" +
        "- [x] Feature tested against staging database (when possible: bin/phx_server_staging.sh)\r\n" +
        "- [x] Feature performance is acceptable with staging data\r\n" +
        "\r\n" +
        "### Acceptance\r\n" +
        "\r\n" +
        "- [x] When applicable, story tested and accepted in Clubhouse using **Review App**\r\n";

      const clubhouseNumber = main.extractClubhouseNumberFromPRBody(mockBody);
      expect(clubhouseNumber).toBe("3681");
    });
  });

  describe("extractClubhouseNumberFromPRTitle", () => {
    test("extracts clubhouse title", () => {
      const title =
        "[ch3681] Properly display/download attachments from an email quote";
      const clubhouseNumber = main.extractClubhouseNumberFromPRTitle(title);
      expect(clubhouseNumber).toBe("3681");
    });
    test("return the first ocurrence only if there are more than one matched", () => {
      const title =
        "[ch3681] Properly display/download attachments from an email quote [ch1234]";
      const clubhouseNumber = main.extractClubhouseNumberFromPRTitle(title);
      expect(clubhouseNumber).toBe("3681");
    });
  });

  describe("extractCategory", () => {
    test("category matches the branch name prefix", () => {
      const arr = ["bug/", "bugfix/", "enhancement/", "feature/", "", "random"];
      const expected = [
        "Bugfix",
        "Bugfix",
        "Feature",
        "Feature",
        "Chore",
        "Chore",
      ];
      for (let i = 0; i < arr.length; i++) {
        const branchName = arr[i],
          expectedPrefix = expected[i],
          prefix = main.extractCategory(branchName);
        expect(prefix).toBe(expectedPrefix);
      }
    });
  });

  describe("extractAllClubhouseNumbersFromLastRelease", () => {
    test("titles collection is empty", () => {
      const body =
        "## What’s Changed\r\n\r\n###  Chores -- ⚙️\r\n\r\n* Appcues installation improvements [ch3617]\r\n\r\n### Bugfixes -- 🐞\r\n\r\n* Price suggestion popover on repair form [ch3481](https://app.clubhouse.io/rotabull/story/3481)\r\n";
      const clubhouseNumbers = main.extractAllClubhouseNumbersFromLastRelease(
        body
      );
      expect(clubhouseNumbers.length).toBe(2);
      expect(clubhouseNumbers.includes("3617")).toBe(true);
      expect(clubhouseNumbers.includes("3481")).toBe(true);
    });
    test("titles collection contains at least 1 element ", () => {});
  });

  describe("extractTitleIgnoringClubhouseNumber", () => {
    test("extract clubhouse number correctly from clubhouse title", () => {
      const clubhouseTitle =
        "[ch3681] Properly display/download attachments from an email quote";
      expect(main.extractTitleIgnoringClubhouseNumber(clubhouseTitle)).toBe(
        "Properly display/download attachments from an email quote"
      );
    });
  });

  // v2020.09.15
  // v2020.09.16.1
  describe("getNextReleaseTag", () => {
    test("when last release is the same date as today", () => {
      const todayDate = moment().format("YYYY.MM.DD");
      const lastReleaseTag = `v${todayDate}`;

      const nextReleaseTag = main.getNextReleaseTag(lastReleaseTag, todayDate);
      expect(nextReleaseTag).toBe(`v${todayDate}.1`);
    });

    test("when last release tag is not the same date as today", () => {
      const todayDate = moment().format("YYYY.MM.DD");
      const lastReleaseTag = `v1990.01.20`;

      const nextReleaseTag = main.getNextReleaseTag(lastReleaseTag, todayDate);
      expect(nextReleaseTag).toBe(`v${todayDate}`);
    });
    test("release tag increases version number within the same date", () => {
      const todayDate = moment().format("YYYY.MM.DD");
      const lastReleaseTag = `v${todayDate}.2`;

      const nextReleaseTag = main.getNextReleaseTag(lastReleaseTag, todayDate);
      expect(nextReleaseTag).toBe(`v${todayDate}.3`);
    });
  });
});
