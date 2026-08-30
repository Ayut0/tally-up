// Generated from: e2e/features/member-lifecycle.feature
import { test } from "../../../e2e/steps/fixtures.ts";

test.describe('Members joining and leaving mid-trip', () => {

  test('A member who joins after expenses exist owes nothing for what they missed', async ({ Given, When, Then, And, addExpense, group, home, members }) => { 
    await Given('a group named "Kyoto trip" with members:', {"dataTable":{"rows":[{"cells":[{"value":"name"}]},{"cells":[{"value":"Yuto"}]},{"cells":[{"value":"Aoi"}]}]}}, { group, home }); 
    await When('Yuto adds an expense of ¥2000 for "lunch" split equally', null, { addExpense, group }); 
    await And('Ren joins the group', null, { members }); 
    await Then('the balances are:', {"dataTable":{"rows":[{"cells":[{"value":"member"},{"value":"balance"}]},{"cells":[{"value":"Ren"},{"value":"¥0"}]}]}}, { group }); 
    await And('Ren is available to split expenses with', null, { addExpense, group }); 
  });

  test('A member with a nonzero balance cannot be removed', async ({ Given, When, Then, And, addExpense, group, home, members }) => { 
    await Given('a group named "Kyoto trip" with members:', {"dataTable":{"rows":[{"cells":[{"value":"name"}]},{"cells":[{"value":"Yuto"}]},{"cells":[{"value":"Aoi"}]}]}}, { group, home }); 
    await When('Yuto adds an expense of ¥2000 for "lunch" split equally', null, { addExpense, group }); 
    await And('Aoi tries to leave the group', null, { members }); 
    await Then('Aoi is refused: "member has a nonzero balance; settle up before removing"', null, { members }); 
    await And('Aoi is still a member of the group', null, { members }); 
  });

  test('A member with a zero balance can be removed', async ({ Given, When, Then, group, home, members }) => { 
    await Given('a group named "Kyoto trip" with members:', {"dataTable":{"rows":[{"cells":[{"value":"name"}]},{"cells":[{"value":"Yuto"}]},{"cells":[{"value":"Aoi"}]}]}}, { group, home }); 
    await When('Aoi leaves the group', null, { members }); 
    await Then('Aoi is no longer a member of the group', null, { members }); 
  });

});

// == technical section ==

test.use({
  $test: [({}, use) => use(test), { scope: 'test', box: true }],
  $uri: [({}, use) => use('e2e/features/member-lifecycle.feature'), { scope: 'test', box: true }],
  $bddFileData: [({}, use) => use(bddFileData), { scope: "test", box: true }],
});

const bddFileData = [ // bdd-data-start
  {"pwTestLine":6,"pickleLine":9,"tags":[],"steps":[{"pwStepLine":7,"gherkinStepLine":10,"keywordType":"Context","textWithKeyword":"Given a group named \"Kyoto trip\" with members:","stepMatchArguments":[{"group":{"start":14,"value":"\"Kyoto trip\"","children":[{"start":15,"value":"Kyoto trip","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":8,"gherkinStepLine":14,"keywordType":"Action","textWithKeyword":"When Yuto adds an expense of ¥2000 for \"lunch\" split equally","stepMatchArguments":[{"group":{"start":0,"value":"Yuto"},"parameterTypeName":"word"},{"group":{"start":25,"value":"2000"},"parameterTypeName":"int"},{"group":{"start":34,"value":"\"lunch\"","children":[{"start":35,"value":"lunch","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":9,"gherkinStepLine":15,"keywordType":"Action","textWithKeyword":"And Ren joins the group","stepMatchArguments":[{"group":{"start":0,"value":"Ren"},"parameterTypeName":"word"}]},{"pwStepLine":10,"gherkinStepLine":16,"keywordType":"Outcome","textWithKeyword":"Then the balances are:","stepMatchArguments":[]},{"pwStepLine":11,"gherkinStepLine":19,"keywordType":"Outcome","textWithKeyword":"And Ren is available to split expenses with","stepMatchArguments":[{"group":{"start":0,"value":"Ren"},"parameterTypeName":"word"}]}]},
  {"pwTestLine":14,"pickleLine":21,"tags":[],"steps":[{"pwStepLine":15,"gherkinStepLine":22,"keywordType":"Context","textWithKeyword":"Given a group named \"Kyoto trip\" with members:","stepMatchArguments":[{"group":{"start":14,"value":"\"Kyoto trip\"","children":[{"start":15,"value":"Kyoto trip","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":16,"gherkinStepLine":26,"keywordType":"Action","textWithKeyword":"When Yuto adds an expense of ¥2000 for \"lunch\" split equally","stepMatchArguments":[{"group":{"start":0,"value":"Yuto"},"parameterTypeName":"word"},{"group":{"start":25,"value":"2000"},"parameterTypeName":"int"},{"group":{"start":34,"value":"\"lunch\"","children":[{"start":35,"value":"lunch","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":17,"gherkinStepLine":27,"keywordType":"Action","textWithKeyword":"And Aoi tries to leave the group","stepMatchArguments":[{"group":{"start":0,"value":"Aoi"},"parameterTypeName":"word"}]},{"pwStepLine":18,"gherkinStepLine":28,"keywordType":"Outcome","textWithKeyword":"Then Aoi is refused: \"member has a nonzero balance; settle up before removing\"","stepMatchArguments":[{"group":{"start":0,"value":"Aoi"},"parameterTypeName":"word"},{"group":{"start":16,"value":"\"member has a nonzero balance; settle up before removing\"","children":[{"start":17,"value":"member has a nonzero balance; settle up before removing","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":19,"gherkinStepLine":29,"keywordType":"Outcome","textWithKeyword":"And Aoi is still a member of the group","stepMatchArguments":[{"group":{"start":0,"value":"Aoi"},"parameterTypeName":"word"}]}]},
  {"pwTestLine":22,"pickleLine":33,"tags":[],"steps":[{"pwStepLine":23,"gherkinStepLine":34,"keywordType":"Context","textWithKeyword":"Given a group named \"Kyoto trip\" with members:","stepMatchArguments":[{"group":{"start":14,"value":"\"Kyoto trip\"","children":[{"start":15,"value":"Kyoto trip","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":24,"gherkinStepLine":38,"keywordType":"Action","textWithKeyword":"When Aoi leaves the group","stepMatchArguments":[{"group":{"start":0,"value":"Aoi"},"parameterTypeName":"word"}]},{"pwStepLine":25,"gherkinStepLine":39,"keywordType":"Outcome","textWithKeyword":"Then Aoi is no longer a member of the group","stepMatchArguments":[{"group":{"start":0,"value":"Aoi"},"parameterTypeName":"word"}]}]},
]; // bdd-data-end