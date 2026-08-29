// Generated from: e2e/features/split-an-expense.feature
import { test } from "../../../e2e/steps/fixtures.ts";

test.describe('Splitting an expense across a group', () => {

  test('An equal split leaves the payer owed and the others owing', async ({ Given, When, Then, And, addExpense, group, home }) => { 
    await Given('a group named "Kyoto trip" with members:', {"dataTable":{"rows":[{"cells":[{"value":"name"}]},{"cells":[{"value":"Yuto"}]},{"cells":[{"value":"Aoi"}]},{"cells":[{"value":"Ren"}]}]}}, { group, home }); 
    await When('Yuto adds an expense of ¥3000 for "dinner" split equally', null, { addExpense, group }); 
    await Then('the balances are:', {"dataTable":{"rows":[{"cells":[{"value":"member"},{"value":"balance"}]},{"cells":[{"value":"Yuto"},{"value":"+¥2,000"}]},{"cells":[{"value":"Aoi"},{"value":"−¥1,000"}]},{"cells":[{"value":"Ren"},{"value":"−¥1,000"}]}]}}, { group }); 
    await And('the history shows "dinner" paid by Yuto', null, { group }); 
  });

});

// == technical section ==

test.use({
  $test: [({}, use) => use(test), { scope: 'test', box: true }],
  $uri: [({}, use) => use('e2e/features/split-an-expense.feature'), { scope: 'test', box: true }],
  $bddFileData: [({}, use) => use(bddFileData), { scope: "test", box: true }],
});

const bddFileData = [ // bdd-data-start
  {"pwTestLine":6,"pickleLine":13,"tags":[],"steps":[{"pwStepLine":7,"gherkinStepLine":14,"keywordType":"Context","textWithKeyword":"Given a group named \"Kyoto trip\" with members:","stepMatchArguments":[{"group":{"start":14,"value":"\"Kyoto trip\"","children":[{"start":15,"value":"Kyoto trip","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":8,"gherkinStepLine":19,"keywordType":"Action","textWithKeyword":"When Yuto adds an expense of ¥3000 for \"dinner\" split equally","stepMatchArguments":[{"group":{"start":0,"value":"Yuto"},"parameterTypeName":"word"},{"group":{"start":25,"value":"3000"},"parameterTypeName":"int"},{"group":{"start":34,"value":"\"dinner\"","children":[{"start":35,"value":"dinner","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":9,"gherkinStepLine":22,"keywordType":"Outcome","textWithKeyword":"Then the balances are:","stepMatchArguments":[]},{"pwStepLine":10,"gherkinStepLine":27,"keywordType":"Outcome","textWithKeyword":"And the history shows \"dinner\" paid by Yuto","stepMatchArguments":[{"group":{"start":18,"value":"\"dinner\"","children":[{"start":19,"value":"dinner","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"},{"group":{"start":35,"value":"Yuto"},"parameterTypeName":"word"}]}]},
]; // bdd-data-end