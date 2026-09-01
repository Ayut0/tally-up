// Generated from: e2e/features/who-owes-whom.feature
import { test } from "../../../e2e/steps/fixtures.ts";

test.describe('Reading who owes whom', () => {

  test('The pairwise view names the debtor, creditor, and amount', async ({ Given, When, Then, And, addExpense, group, home, owes }) => { 
    await Given('a group named "Kyoto trip" with members:', {"dataTable":{"rows":[{"cells":[{"value":"name"}]},{"cells":[{"value":"Yuto"}]},{"cells":[{"value":"Aoi"}]}]}}, { group, home }); 
    await When('Yuto adds an expense of ¥2000 for "lunch" split equally', null, { addExpense, group }); 
    await And('Aoi adds an expense of ¥600 for "coffee" split equally', null, { addExpense, group }); 
    await And('someone checks who owes whom', null, { group }); 
    await Then('Aoi owes Yuto ¥700', null, { owes }); 
  });

  test('Once every balance is ¥0, the page says everyone\'s settled', async ({ Given, When, Then, And, addExpense, group, home, owes }) => { 
    await Given('a group named "Kyoto trip" with members:', {"dataTable":{"rows":[{"cells":[{"value":"name"}]},{"cells":[{"value":"Yuto"}]},{"cells":[{"value":"Aoi"}]}]}}, { group, home }); 
    await When('Yuto adds an expense of ¥1000 for "lunch" split equally', null, { addExpense, group }); 
    await And('Aoi adds an expense of ¥1000 for "coffee" split equally', null, { addExpense, group }); 
    await And('someone checks who owes whom', null, { group }); 
    await Then('the group is settled up', null, { owes }); 
  });

});

// == technical section ==

test.use({
  $test: [({}, use) => use(test), { scope: 'test', box: true }],
  $uri: [({}, use) => use('e2e/features/who-owes-whom.feature'), { scope: 'test', box: true }],
  $bddFileData: [({}, use) => use(bddFileData), { scope: "test", box: true }],
});

const bddFileData = [ // bdd-data-start
  {"pwTestLine":6,"pickleLine":9,"tags":[],"steps":[{"pwStepLine":7,"gherkinStepLine":10,"keywordType":"Context","textWithKeyword":"Given a group named \"Kyoto trip\" with members:","stepMatchArguments":[{"group":{"start":14,"value":"\"Kyoto trip\"","children":[{"start":15,"value":"Kyoto trip","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":8,"gherkinStepLine":14,"keywordType":"Action","textWithKeyword":"When Yuto adds an expense of ¥2000 for \"lunch\" split equally","stepMatchArguments":[{"group":{"start":0,"value":"Yuto"},"parameterTypeName":"word"},{"group":{"start":25,"value":"2000"},"parameterTypeName":"int"},{"group":{"start":34,"value":"\"lunch\"","children":[{"start":35,"value":"lunch","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":9,"gherkinStepLine":15,"keywordType":"Action","textWithKeyword":"And Aoi adds an expense of ¥600 for \"coffee\" split equally","stepMatchArguments":[{"group":{"start":0,"value":"Aoi"},"parameterTypeName":"word"},{"group":{"start":24,"value":"600"},"parameterTypeName":"int"},{"group":{"start":32,"value":"\"coffee\"","children":[{"start":33,"value":"coffee","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":10,"gherkinStepLine":16,"keywordType":"Action","textWithKeyword":"And someone checks who owes whom","stepMatchArguments":[]},{"pwStepLine":11,"gherkinStepLine":21,"keywordType":"Outcome","textWithKeyword":"Then Aoi owes Yuto ¥700","stepMatchArguments":[{"group":{"start":0,"value":"Aoi"},"parameterTypeName":"word"},{"group":{"start":9,"value":"Yuto"},"parameterTypeName":"word"},{"group":{"start":15,"value":"700"},"parameterTypeName":"int"}]}]},
  {"pwTestLine":14,"pickleLine":23,"tags":[],"steps":[{"pwStepLine":15,"gherkinStepLine":24,"keywordType":"Context","textWithKeyword":"Given a group named \"Kyoto trip\" with members:","stepMatchArguments":[{"group":{"start":14,"value":"\"Kyoto trip\"","children":[{"start":15,"value":"Kyoto trip","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":16,"gherkinStepLine":28,"keywordType":"Action","textWithKeyword":"When Yuto adds an expense of ¥1000 for \"lunch\" split equally","stepMatchArguments":[{"group":{"start":0,"value":"Yuto"},"parameterTypeName":"word"},{"group":{"start":25,"value":"1000"},"parameterTypeName":"int"},{"group":{"start":34,"value":"\"lunch\"","children":[{"start":35,"value":"lunch","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":17,"gherkinStepLine":29,"keywordType":"Action","textWithKeyword":"And Aoi adds an expense of ¥1000 for \"coffee\" split equally","stepMatchArguments":[{"group":{"start":0,"value":"Aoi"},"parameterTypeName":"word"},{"group":{"start":24,"value":"1000"},"parameterTypeName":"int"},{"group":{"start":33,"value":"\"coffee\"","children":[{"start":34,"value":"coffee","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":18,"gherkinStepLine":30,"keywordType":"Action","textWithKeyword":"And someone checks who owes whom","stepMatchArguments":[]},{"pwStepLine":19,"gherkinStepLine":37,"keywordType":"Outcome","textWithKeyword":"Then the group is settled up","stepMatchArguments":[]}]},
]; // bdd-data-end