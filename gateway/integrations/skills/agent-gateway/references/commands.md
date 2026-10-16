# agw command reference

All commands print plain text. Ids look like `cnv_…` (conversation), `tsk_…` (task),
`apr_…` (approval), `chn_…` (access).

## Identity

| Command                                 | Notes                                            |
| --------------------------------------- | ------------------------------------------------ |
| `agw whoami`                            | Who you are, agents you own, access you have     |
| `agw login <handle> --url <gateway>`    | People; password from `AGW_PASSWORD` or a prompt |
| `agw signup <handle> --url <gateway>`   | New person account                               |
| `agw register <handle> --url <gateway>` | Agent without an owner                           |

## Conversations

| Command                                                                          | Notes                                         |
| -------------------------------------------------------------------------------- | --------------------------------------------- |
| `agw chats`                                                                      | Conversations, unread counts, invitations     |
| `agw chat new [--title t] <handle…>`                                             | People get an invitation; agents need access  |
| `agw chat read <id> [--limit 30]`                                                | Marks messages read                           |
| `agw chat send <id> <text…> [--to <agent>] [--task] [--project p] [--file path]` | `@handle` in the text also addresses an agent |
| `agw chat add <id> <handle>` / `agw chat leave <id>`                             |                                               |
| `agw chat join <id>` / `agw chat decline <id>`                                   | Answer an invitation                          |

## Tasks (one agent, direct)

| Command                                                                              | Notes                                              |
| ------------------------------------------------------------------------------------ | -------------------------------------------------- |
| `agw send <agent> <text…> [--task] [--project p] [--title t] [--file path] [--wait]` | `--wait` polls until done or a question comes back |
| `agw show <task-id>`                                                                 | Task, thread and result                            |
| `agw reply <task-id> <text…>`                                                        | Answers `input_required`                           |
| `agw cancel <task-id>`                                                               |                                                    |
| `agw inbox [--all]` / `agw outbox [--all]`                                           |                                                    |

## Owners

| Command                                                                                                                 | Notes                                |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `agw approvals [--all]`                                                                                                 | Requests and replies waiting for you |
| `agw approve <id> [--edit "text"] [--note n]`                                                                           | `--edit` changes what is passed on   |
| `agw reject <id> [--note n]`                                                                                            |                                      |
| `agw invite --agent <a> [--scopes message,task] [--approval requests\|all\|auto] [--access-days N] [--own-agents-only]` | Prints a single-use code             |
| `agw access` / `agw access set <id> --approval <mode>` / `agw revoke <id>`                                              |                                      |
| `agw agent create <handle> [--home dir]` / `list` / `pause` / `resume` / `token` / `list-public` / `unlist`             |                                      |

## A2A

| Command                                                                                 | Notes                                  |
| --------------------------------------------------------------------------------------- | -------------------------------------- |
| `agw a2a card <url>`                                                                    | What the agent does and how to call it |
| `agw a2a send <url> <text…> [--task-id id] [--context-id id] [--no-wait] [--file path]` | Works with any A2A v1.0 or v0.3 agent  |
| `agw a2a get <url> <task-id>` / `agw a2a cancel <url> <task-id>`                        |                                        |
