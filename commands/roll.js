const {
  SlashCommandBuilder,
  codeBlock
} = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('roll')
    .setDescription('Dice roll.')
    .addStringOption((option) =>
      option.setName('dice')
        .setDescription("Dice's to roll.")
        .setRequired(true)),
  execute(interaction) {
    const dice = interaction.options.getString('dice');
    const baseDice = Array.from(dice),
      sortedNumbers = [],
      trimmedDice = [],
      rolledDices = [],
      filteredDice = [];

    let numbers = '',
      logicalDice = [],
      diceSplits = [],
      resolvedDice = '',
      Total;

    for (n of baseDice) {
      if (['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 'd'].some((d) => d == n)) {
        numbers += n;
        continue;
      }
      if (['+', '-', '*', '/', '^', '(', ')'].some((d) => d == n)) {
        if (numbers.length) {
          sortedNumbers.push(numbers);
          numbers = '';
        }
        sortedNumbers.push(n);
        continue;
      }
      return interaction.reply({
        content: `> **Roll**: \`${dice}\`.\nUnexpected \`\'${n}\'\`.`,
        ephemeral: true,
      });
    }

    if (numbers.length) sortedNumbers.push(numbers);
    let previous;

    for (s of sortedNumbers) {
      if (previous != s) trimmedDice.push(s);
      previous = s;
    }

    if (trimmedDice.some((p) => p == '(') ? !trimmedDice.some((p) => p == ')') : trimmedDice.some((p) => p == ')'))
      return interaction.reply({
        content: `> **Roll**: \`${dice}\`.\nUnexpected \`\'${trimmedDice.find((k) => k == '(') ?? trimmedDice.find((k) => k == ')')}\'\`.`,
        ephemeral: true,
      });

    for (t of trimmedDice) {
      if (t.includes('d')) {
        logicalDice = t.split('d');
        logicalDice = logicalDice.map((i) => i.replace(/^$/, '1'));
        if (logicalDice.length > 2)
          return interaction.reply({
            content: `> **Roll**: \`${dice}\`.\nInvalid Dice \`\'${t}\'\`.`,
            ephemeral: true,
          });
        for (t = 1; t <= logicalDice[0]; t++) {
          let r = Math.floor(Math.random() * logicalDice[1]) + 1;
          rolledDices.push(r);
          diceSplits.push(r);
        }
        filteredDice.push(diceSplits);
        diceSplits = [];
      } else filteredDice.push(t);
    }

    for (f of filteredDice) {
      if (typeof f == 'object') f = f.reduce((a, c) => a + c, 0);
      resolvedDice += f;
    }

    try {
      Total = global.eval(resolvedDice);
    } catch (err) {
      return interaction.reply({
        content: `> **Roll**: \`${dice}\`.\nUnexpected input.`,
        ephemeral: true,
      });
    }

    interaction.reply(codeBlock('prolog', `# ${Total}\nDetails:['${trimmedDice.join('')}' (${rolledDices.join(' ')})]`)); //css, ml, md, prolog
  }
}