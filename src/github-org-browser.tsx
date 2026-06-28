import { ActionPanel, Action, Cache, Detail, Icon, Image, List, getPreferenceValues, openExtensionPreferences } from "@raycast/api";
import { useFetch, usePromise } from "@raycast/utils";
import { useState } from "react";

const USER_REPOS_KEY = "__user__";
const cache = new Cache();
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;

interface Preferences {
  token: string;
}

interface User {
  login: string;
  avatar_url: string;
}

interface Organization {
  login: string;
  avatar_url: string;
}

interface Repository {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  html_url: string;
  clone_url: string;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  private: boolean;
}

interface CacheEntry {
  timestamp: number;
  data: Repository[];
}

function getNextPageUrl(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  for (const link of linkHeader.split(",")) {
    const parts = link.split(";");
    const isNext = parts.some((part) => part.trim() === 'rel="next"');
    if (isNext) return parts[0].trim().slice(1, -1);
  }
  return null;
}

async function fetchAllPages(url: string, headers: Record<string, string>): Promise<Repository[]> {
  const results: Repository[] = [];
  let nextUrl: string | null = url;

  while (nextUrl) {
    const response = await fetch(nextUrl, { headers });
    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }
    const data = (await response.json()) as Repository[];
    results.push(...data);
    nextUrl = getNextPageUrl(response.headers.get("Link"));
  }

  return results;
}

export default function Command() {
  const { token } = getPreferenceValues<Preferences>();
  const [selectedOrg, setSelectedOrg] = useState(USER_REPOS_KEY);

  const headers = { Authorization: `Bearer ${token}` };

  const { data: user } = useFetch<User>("https://api.github.com/user", { headers });

  const {
    data: orgs,
    isLoading: isOrgsLoading,
    error: orgsError,
  } = useFetch<Organization[]>("https://api.github.com/user/orgs", { headers });

  if (orgsError) {
    return (
      <Detail
        markdown={`# Access Denied\n\nGitHub returned: **${orgsError.message}**\n\nYour token needs the **read:org** scope to list organizations. Create a token with the \`read:org\` scope at the link below.`}
        actions={
          <ActionPanel>
            <Action.OpenInBrowser url="https://github.com/settings/tokens" title="Open Token Settings" />
            <Action title="Open Extension Preferences" onAction={openExtensionPreferences} />
          </ActionPanel>
        }
      />
    );
  }

  const isUserRepos = selectedOrg === USER_REPOS_KEY;
  const activeTarget = isUserRepos ? (user?.login || "your") : selectedOrg;
  const cacheKey = `repos-${selectedOrg}`;
  const reposUrl = isUserRepos
    ? "https://api.github.com/user/repos?per_page=100&sort=updated&direction=desc&type=owner"
    : `https://api.github.com/orgs/${selectedOrg}/repos?per_page=100&sort=updated&direction=desc`;

  const { isLoading: isReposLoading, data: repos, revalidate } = usePromise(
    async (key: string, url: string) => {
      const raw = cache.get(key);
      if (raw) {
        const entry = JSON.parse(raw) as CacheEntry;
        if (Date.now() - entry.timestamp < CACHE_TTL) {
          return entry.data;
        }
      }
      const data = await fetchAllPages(url, headers);
      const entry: CacheEntry = { timestamp: Date.now(), data };
      cache.set(key, JSON.stringify(entry));
      return data;
    },
    [cacheKey, reposUrl],
    { initialData: [] as Repository[] },
  );

  function handleRefresh() {
    cache.remove(cacheKey);
    revalidate();
  }

  return (
    <List
      isLoading={isOrgsLoading || isReposLoading}
      throttle
      navigationTitle={`${activeTarget} Repos`}
      searchBarPlaceholder="Search repositories..."
      searchBarAccessory={
        <List.Dropdown tooltip="Select repositories source" value={selectedOrg} onChange={setSelectedOrg}>
          {user && (
            <List.Dropdown.Item
              key={USER_REPOS_KEY}
              title={`${user.login} (personal)`}
              value={USER_REPOS_KEY}
              icon={{ source: user.avatar_url, mask: Image.Mask.Circle }}
            />
          )}
          {orgs?.map((org) => (
            <List.Dropdown.Item
              key={org.login}
              title={org.login}
              value={org.login}
              icon={{ source: org.avatar_url, mask: Image.Mask.Circle }}
            />
          ))}
        </List.Dropdown>
      }
    >
      {repos?.map((repo) => (
        <List.Item
          key={repo.id}
          icon={repo.private ? Icon.Lock : Icon.LockUnlocked}
          title={repo.name}
          subtitle={repo.description || ""}
          accessories={[
            ...(repo.language ? [{ text: repo.language }] : []),
            ...(repo.stargazers_count > 0 ? [{ icon: Icon.Star, text: String(repo.stargazers_count) }] : []),
          ]}
          actions={
            <ActionPanel>
              <ActionPanel.Section>
                <Action.OpenInBrowser url={repo.html_url} icon={Icon.Globe} />
                <Action.OpenInBrowser
                  title="Open Pull Requests"
                  url={`https://github.com/${repo.full_name}/pulls`}
                  icon={Icon.SpeechBubble}
                  shortcut={{ modifiers: ["cmd", "shift"], key: "p" }}
                />
                <Action.OpenInBrowser
                  title="Open Issues"
                  url={`https://github.com/${repo.full_name}/issues`}
                  icon={Icon.Bug}
                  shortcut={{ modifiers: ["cmd", "shift"], key: "i" }}
                />
              </ActionPanel.Section>
              <ActionPanel.Section>
                <Action.CopyToClipboard content={repo.html_url} title="Copy URL" />
                <Action.CopyToClipboard content={`git clone ${repo.clone_url}`} title="Copy Clone URL" />
              </ActionPanel.Section>
              <ActionPanel.Section>
                <Action title="Refresh Cache" icon={Icon.ArrowClockwise} onAction={handleRefresh} />
              </ActionPanel.Section>
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}
