#!/usr/bin/env node
import { program } from 'commander'
import { joinCommand } from './commands/join.js'
import { watchCommand } from './commands/watch.js'
import { editCommand } from './commands/edit.js'
import { createCommand } from './commands/create.js'
import { commentsCommand } from './commands/comments.js'

program.name('pairedcc').version('0.0.1').description('paired.cc CLI')

program.command('create [file]')
  .description('Create a doc from a markdown file (or stdin) and print its shareable URL')
  .option('--key <api-key>', 'API key (optional — omit for an anonymous, link-shareable doc)')
  .option('--url <url>', 'Server URL', 'https://paired.cc')
  .option('--title <title>', 'Document title (defaults to the first heading)')
  .action(createCommand)

program.command('join <doc-id>').description('Join a document as a Yjs peer')
  .option('--key <api-key>', 'API key').option('--url <url>', 'Server URL', 'https://paired.cc')
  .action(joinCommand)

program.command('watch <doc-id>').description('Watch for @-mentions')
  .option('--key <api-key>', 'API key').option('--url <url>', 'Server URL', 'https://paired.cc')
  .action(watchCommand)

program.command('edit <doc-id>').description('Make a one-shot edit')
  .argument('<anchor>', 'Text to find').argument('<content>', 'Replacement content')
  .option('--key <api-key>', 'API key').option('--url <url>', 'Server URL', 'https://paired.cc')
  .action(editCommand)

program.command('comments <subcommand> [args...]')
  .description('Agent comment inbox: list | show <doc> <id> | reply <doc> <id> <body> | resolve <doc> <id>')
  .option('--key <api-key>', 'API key').option('--url <url>', 'Server URL', 'https://paired.cc')
  .option('--doc <doc-id>', 'Scope list to a single document')
  .option('--status <status>', 'Filter: open | resolved | all', 'open')
  .action((subcommand: string, args: string[], opts: { key: string; url: string; doc?: string; status?: string }) =>
    commentsCommand(subcommand, args, opts))

program.parse()
