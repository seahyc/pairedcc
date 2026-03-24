#!/usr/bin/env node
import { program } from 'commander'
import { joinCommand } from './commands/join.js'
import { watchCommand } from './commands/watch.js'
import { editCommand } from './commands/edit.js'

program.name('pairedcc').version('0.0.1').description('paired.cc CLI')

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

program.parse()
