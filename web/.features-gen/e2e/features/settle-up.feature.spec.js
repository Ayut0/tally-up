// Generated from: e2e/features/settle-up.feature
import { test } from "../../../e2e/steps/fixtures.ts";

test.describe('Settling up on the proposed plan', () => {

  test('Marking the proposed transfer paid settles the group', async ({ Given, When, Then, And, addExpense, group, home, settle }) => { 
    await Given('a group named "Kyoto trip" with members:', {"dataTable":{"rows":[{"cells":[{"value":"name"}]},{"cells":[{"value":"Yuto"}]},{"cells":[{"value":"Aoi"}]}]}}, { group, home }); 
    await When('Yuto adds an expense of ¥2000 for "dinner" split equally', null, { addExpense, group }); 
    await And('someone views the settle plan', null, { group }); 
    await Then('the settle plan proposes:', {"dataTable":{"rows":[{"cells":[{"value":"from"},{"value":"to"},{"value":"amount"}]},{"cells":[{"value":"Aoi"},{"value":"Yuto"},{"value":"¥1,000"}]}]}}, { settle }); 
    await When('Aoi pays Yuto ¥1000', null, { settle }); 
    await Then('the settle plan is empty', null, { settle }); 
    await When('someone returns to the group', null, { settle }); 
    await And('the balances are:', {"dataTable":{"rows":[{"cells":[{"value":"member"},{"value":"balance"}]},{"cells":[{"value":"Yuto"},{"value":"¥0"}]},{"cells":[{"value":"Aoi"},{"value":"¥0"}]}]}}, { group }); 
  });

});

// == technical section ==

test.use({
  $test: [({}, use) => use(test), { scope: 'test', box: true }],
  $uri: [({}, use) => use('e2e/features/settle-up.feature'), { scope: 'test', box: true }],
  $bddFileData: [({}, use) => use(bddFileData), { scope: "test", box: true }],
});

const bddFileData = [ // bdd-data-start
  {"pwTestLine":6,"pickleLine":10,"tags":[],"steps":[{"pwStepLine":7,"gherkinStepLine":11,"keywordType":"Context","textWithKeyword":"Given a group named \"Kyoto trip\" with members:","stepMatchArguments":[{"group":{"start":14,"value":"\"Kyoto trip\"","children":[{"start":15,"value":"Kyoto trip","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":8,"gherkinStepLine":15,"keywordType":"Action","textWithKeyword":"When Yuto adds an expense of ¥2000 for \"dinner\" split equally","stepMatchArguments":[{"group":{"start":0,"value":"Yuto"},"parameterTypeName":"word"},{"group":{"start":25,"value":"2000"},"parameterTypeName":"int"},{"group":{"start":34,"value":"\"dinner\"","children":[{"start":35,"value":"dinner","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":9,"gherkinStepLine":16,"keywordType":"Action","textWithKeyword":"And someone views the settle plan","stepMatchArguments":[]},{"pwStepLine":10,"gherkinStepLine":21,"keywordType":"Outcome","textWithKeyword":"Then the settle plan proposes:","stepMatchArguments":[]},{"pwStepLine":11,"gherkinStepLine":24,"keywordType":"Action","textWithKeyword":"When Aoi pays Yuto ¥1000","stepMatchArguments":[{"group":{"start":0,"value":"Aoi"},"parameterTypeName":"word"},{"group":{"start":9,"value":"Yuto"},"parameterTypeName":"word"},{"group":{"start":15,"value":"1000"},"parameterTypeName":"int"}]},{"pwStepLine":12,"gherkinStepLine":25,"keywordType":"Outcome","textWithKeyword":"Then the settle plan is empty","stepMatchArguments":[]},{"pwStepLine":13,"gherkinStepLine":26,"keywordType":"Action","textWithKeyword":"When someone returns to the group","stepMatchArguments":[]},{"pwStepLine":14,"gherkinStepLine":31,"keywordType":"Action","textWithKeyword":"And the balances are:","stepMatchArguments":[]}]},
]; // bdd-data-end