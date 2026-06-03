import { Command } from 'commander';

const program = new Command();

program
  .name('docrawl')
  .description('Crawl documentation sites into Markdown')
  .version('0.1.0');

program.parse();
