import { Devvit } from "@devvit/public-api";

Devvit.configure({
  redditAPI: true,
  redis: true,
  http: {
    domains: ["linkbreakers.com"],
  },
});

interface LatestArticle {
  slug: string;
  title: string;
  description: string;
  category: string;
  publishedAt: string;
  url: string;
  shortAnswer: string;
}

function buildRedditPost(article: LatestArticle): { title: string; body: string } {
  const title = article.title;

  const lines: string[] = [];

  if (article.shortAnswer) {
    lines.push(article.shortAnswer);
    lines.push("");
  } else if (article.description) {
    lines.push(article.description);
    lines.push("");
  }

  lines.push(`**Read the full article:** [${article.title}](${article.url})`);
  lines.push("");
  lines.push("---");
  lines.push(
    "*This post is part of the [Linkbreakers Help Center](https://linkbreakers.com/help) — practical guides on QR codes, link tracking, and campaign analytics.*"
  );

  return { title, body: lines.join("\n") };
}

Devvit.addSchedulerJob({
  name: "daily_blog_post",
  onRun: async (_event, context) => {
    try {
      const response = await fetch(
        "https://linkbreakers.com/api/latest-article"
      );

      if (!response.ok) {
        console.error(
          `Failed to fetch latest article: ${response.status} ${response.statusText}`
        );
        return;
      }

      const article: LatestArticle = await response.json();

      // Check if we already posted this article
      const alreadyPosted = await context.redis.get(
        `posted:${article.slug}`
      );
      if (alreadyPosted) {
        console.log(`Article already posted: ${article.slug}`);
        return;
      }

      const subreddit = await context.reddit.getCurrentSubreddit();
      const { title, body } = buildRedditPost(article);

      await context.reddit.submitPost({
        subredditName: subreddit.name,
        title,
        text: body,
      });

      // Mark as posted (keep for 90 days)
      await context.redis.set(`posted:${article.slug}`, "1", {
        expiration: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      });

      console.log(
        `Posted article to r/${subreddit.name}: ${article.slug}`
      );
    } catch (error) {
      console.error("Failed to post article:", error);
    }
  },
});

// Schedule the daily job when the app is installed on a subreddit
Devvit.addTrigger({
  event: "AppInstall",
  onEvent: async (_event, context) => {
    try {
      const jobId = await context.scheduler.runJob({
        cron: "0 9 * * *", // 9 AM UTC = 11 AM Paris, ~3h after blog generation
        name: "daily_blog_post",
        data: {},
      });

      await context.redis.set("daily_blog_post_job_id", jobId);
      console.log(`Scheduled daily blog post job: ${jobId}`);
    } catch (error) {
      console.error("Failed to schedule daily blog post job:", error);
    }
  },
});

// Clean up the job when the app is removed
Devvit.addTrigger({
  event: "AppUpgrade",
  onEvent: async (_event, context) => {
    // Cancel existing job and reschedule (in case cron changed)
    const existingJobId = await context.redis.get("daily_blog_post_job_id");
    if (existingJobId) {
      try {
        await context.scheduler.cancelJob(existingJobId);
      } catch {
        // Job may not exist anymore
      }
    }

    const jobId = await context.scheduler.runJob({
      cron: "0 9 * * *",
      name: "daily_blog_post",
      data: {},
    });

    await context.redis.set("daily_blog_post_job_id", jobId);
    console.log(`Rescheduled daily blog post job on upgrade: ${jobId}`);
  },
});

export default Devvit;
