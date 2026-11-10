/**
 * workflow 技能的完整指南。
 *
 * 通过 api.registerSkill 内嵌注册，模型在调用 workflow_run 前用
 * skill_learn("workflow") 按需加载，不占每轮工具定义。
 *
 * 注意：正文不使用反引号，避免与模板字符串分隔符冲突；
 * 代码示例用缩进表示。
 */

export const WORKFLOW_SKILL_DESCRIPTION =
  "Required reading before calling workflow_run: script hooks (agent/pipeline/parallel/phase), failure semantics, limits, agent selection and examples.";

export const WORKFLOW_SKILL = `# Workflow Script

Use workflow_run to run a JavaScript script that orchestrates sub-agents at scale: fan work out across many independent pieces (audits over many files, migrations, multi-angle research, adversarial verification) and collect structured results.

Workflows cannot run inside sub-agent sessions (no nesting). If the tool is not in your function list, workflows are unavailable for this session — the user must enable at least one sub-agent and keep the workflow toolkit enabled.

## Tool signature

workflow_run({ name, description?, phases?, script, args? })

- name: concise workflow name (required).
- description: optional one-line description.
- phases: optional array of { title, detail? } for progress display. Pure narration; it does not impose execution structure.
- script: plain JavaScript body ONLY (NOT TypeScript). Top-level await is allowed. End with return <JSON-serializable value>; that value is the tool result.
- args: optional JSON object exposed to the script as the global variable args.
- The call blocks until the whole script finishes; the user watches live progress and can stop it. The return value is your final result, so make it a well-organized summary.

## Script environment

The script runs in an isolated worker with ONLY these globals:

- agent(prompt, opts?) -> Promise<string | null>
- pipeline(items, ...stages) -> Promise<any[]>
- parallel(thunks) -> Promise<any[]>
- phase(title) -> void
- log(message) -> void
- args (the tool call's args input, verbatim)

No filesystem, network, timers (setTimeout/setInterval), or Node.js APIs are provided. The agents do the work; the script only coordinates them.

## Hooks

### agent(prompt, opts?)

Run one sub-agent to completion in an independent session with its own tools and context.

- Resolves to the child's final output text, or null when the child fails (filter with .filter(Boolean)).
- opts is optional and accepts ONLY: agentId (persona id from the Available Agents list in the system prompt), label (display name), phase (progress group). Any other key is rejected loudly.
- prompt must be a non-empty string. Sub-agents cannot see this conversation or each other: pass all needed context in the prompt.

### pipeline(items, ...stages)

Run each item through the stages independently, with NO barrier between stages (prefer this for multi-stage work).

- Each stage receives (prev, item, index) and may be async.
- An ordinary stage throw drops that ITEM to null and skips its remaining stages; other items are unaffected.
- Items do not wait for each other between stages: item A may already be in stage 2 while item B is still in stage 1.

### parallel(thunks)

Run zero-argument functions concurrently and await ALL of them (a barrier; use only when a stage genuinely needs every prior result together).

- Each thunk may be async.
- A throwing thunk resolves to null; other thunks still complete.

### phase(title) and log(message)

- phase(title) starts a progress phase shown in the UI.
- log(message) narrates progress inside the current phase.
- Keep them short; they are user-facing progress, not results.

## Failure semantics

- Sub-agent fails or is aborted: agent() resolves null.
- Ordinary stage throw in pipeline: that item becomes null, remaining stages skipped.
- Ordinary thunk throw in parallel: that thunk resolves null.
- Hook misuse (bad arguments, unknown opts keys, item caps) throws a fatal error that ALWAYS kills the whole script.
- A non-whitelisted agentId also kills the script (AGENT_START) — pick ids only from the Available Agents list.
- User cancellation rejects pending agent calls; the script stops at the next hook boundary.

Do not try to catch hook misuse to continue: fatal errors are not recoverable inside the script. Ordinary per-item failures are already represented as null; there is nothing to catch.

## Limits

- Concurrency cap on simultaneous sub-agents (CPU-based default, hard max 32).
- Total-agent cap per run (default 100).
- Up to 4096 items per pipeline()/parallel() call.
- The run executes in the foreground; long scripts keep the tool call open.

## Choosing agents

- Use agentId values from the Available Agents list in the system prompt (the Sub-Agents section). The same whitelist gates subagent_spawn and workflow agent().
- Omit agentId (or pass "generic") to use the generic sub-agent for tasks that do not match a dedicated persona.
- Match personas by their descriptions; when the user names an agent, use it unconditionally.
- If you are unsure which agents are enabled, omit agentId rather than guessing: a wrong id kills the script.

## Rules

1. Write self-contained prompts: sub-agents cannot see this conversation or each other; include all context, inputs and deliverable format.
2. Never assign the same file to multiple sub-agents for modification; keep write scopes disjoint.
3. The tool returns only after the whole workflow finishes. The user sees the final answer and the progress stream, not the inner transcripts — return a concise, well-organized summary.
4. Prefer pipeline() for multi-stage work and parallel() only for genuine barriers.
5. Do not use workflows for one or two delegations; plain subagent_spawn calls are cheaper.

## Example: fan-out audit over many files

    const files = args.files; // string[]
    phase("Audit");
    const reports = await parallel(
      files.map((f) => async () => {
        log("auditing " + f);
        return agent(
          "Audit file " + f + " for security issues. Return findings as a short markdown list.",
          { label: "audit " + f, phase: "Audit" }
        );
      })
    );
    const findings = reports.filter(Boolean);
    return { audited: files.length, failed: reports.length - findings.length, findings };

## Example: multi-stage pipeline (no barrier)

    const topics = args.topics;
    const results = await pipeline(
      topics,
      async (prev, topic) => agent("Draft an outline for: " + topic, { phase: "Draft" }),
      async (outline, topic) => agent("Write a section from this outline:\n" + outline, { phase: "Write" })
    );
    return results.map((r, i) => ({ topic: topics[i], ok: r !== null, text: r }));

## Example: adversarial verification

    const candidates = args.candidates;
    const verified = await parallel(
      candidates.map((c) => async () => {
        const verdict = await agent(
          "Try to refute this claim; answer REFUTED or CONFIRMED with one reason:\n" + c,
          { phase: "Verify" }
        );
        return { claim: c, verdict: verdict || "UNKNOWN" };
      })
    );
    return { confirmed: verified.filter((v) => v.verdict.startsWith("CONFIRMED")) };
`;
