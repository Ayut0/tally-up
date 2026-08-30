// Generated from: e2e/features/join-via-invite-link.feature
import { test } from "../../../e2e/steps/fixtures.ts";

test.describe('A friend opens the invite link and picks who they are', () => {

  test('A second phone joins by picking a name', async ({ Given, When, Then, And, group, home, secondPhone }) => { 
    await Given('a group named "Kyoto trip" with members:', {"dataTable":{"rows":[{"cells":[{"value":"name"}]},{"cells":[{"value":"Yuto"}]},{"cells":[{"value":"Aoi"}]}]}}, { group, home }); 
    await When('a second phone opens the invite link', null, { group, secondPhone }); 
    await And('picks Aoi', null, { secondPhone }); 
    await Then('the second phone lands on the group page', null, { secondPhone }); 
    await When('the second phone reopens the invite link', null, { group, secondPhone }); 
    await Then('the second phone is not asked again', null, { secondPhone }); 
  });

  test('A second phone that hasn\'t picked yet is still asked on reopen', async ({ Given, When, Then, And, group, home, secondPhone }) => { 
    await Given('a group named "Kyoto trip" with members:', {"dataTable":{"rows":[{"cells":[{"value":"name"}]},{"cells":[{"value":"Yuto"}]},{"cells":[{"value":"Aoi"}]}]}}, { group, home }); 
    await When('a second phone opens the invite link', null, { group, secondPhone }); 
    await And('the second phone reopens the invite link', null, { group, secondPhone }); 
    await Then('the second phone is asked who they are', null, { secondPhone }); 
  });

  test('A broken invite link shows an error, not the picker', async ({ When, Then, secondPhone }) => { 
    await When('a second phone opens a broken invite link', null, { secondPhone }); 
    await Then('the second phone sees a "group not found" error', null, { secondPhone }); 
  });

});

// == technical section ==

test.use({
  $test: [({}, use) => use(test), { scope: 'test', box: true }],
  $uri: [({}, use) => use('e2e/features/join-via-invite-link.feature'), { scope: 'test', box: true }],
  $bddFileData: [({}, use) => use(bddFileData), { scope: "test", box: true }],
});

const bddFileData = [ // bdd-data-start
  {"pwTestLine":6,"pickleLine":9,"tags":[],"steps":[{"pwStepLine":7,"gherkinStepLine":10,"keywordType":"Context","textWithKeyword":"Given a group named \"Kyoto trip\" with members:","stepMatchArguments":[{"group":{"start":14,"value":"\"Kyoto trip\"","children":[{"start":15,"value":"Kyoto trip","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":8,"gherkinStepLine":14,"keywordType":"Action","textWithKeyword":"When a second phone opens the invite link","stepMatchArguments":[]},{"pwStepLine":9,"gherkinStepLine":15,"keywordType":"Action","textWithKeyword":"And picks Aoi","stepMatchArguments":[{"group":{"start":6,"value":"Aoi"},"parameterTypeName":"word"}]},{"pwStepLine":10,"gherkinStepLine":16,"keywordType":"Outcome","textWithKeyword":"Then the second phone lands on the group page","stepMatchArguments":[]},{"pwStepLine":11,"gherkinStepLine":17,"keywordType":"Action","textWithKeyword":"When the second phone reopens the invite link","stepMatchArguments":[]},{"pwStepLine":12,"gherkinStepLine":18,"keywordType":"Outcome","textWithKeyword":"Then the second phone is not asked again","stepMatchArguments":[]}]},
  {"pwTestLine":15,"pickleLine":20,"tags":[],"steps":[{"pwStepLine":16,"gherkinStepLine":21,"keywordType":"Context","textWithKeyword":"Given a group named \"Kyoto trip\" with members:","stepMatchArguments":[{"group":{"start":14,"value":"\"Kyoto trip\"","children":[{"start":15,"value":"Kyoto trip","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":17,"gherkinStepLine":25,"keywordType":"Action","textWithKeyword":"When a second phone opens the invite link","stepMatchArguments":[]},{"pwStepLine":18,"gherkinStepLine":26,"keywordType":"Action","textWithKeyword":"And the second phone reopens the invite link","stepMatchArguments":[]},{"pwStepLine":19,"gherkinStepLine":27,"keywordType":"Outcome","textWithKeyword":"Then the second phone is asked who they are","stepMatchArguments":[]}]},
  {"pwTestLine":22,"pickleLine":29,"tags":[],"steps":[{"pwStepLine":23,"gherkinStepLine":30,"keywordType":"Action","textWithKeyword":"When a second phone opens a broken invite link","stepMatchArguments":[]},{"pwStepLine":24,"gherkinStepLine":31,"keywordType":"Outcome","textWithKeyword":"Then the second phone sees a \"group not found\" error","stepMatchArguments":[{"group":{"start":24,"value":"\"group not found\"","children":[{"start":25,"value":"group not found","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]}]},
]; // bdd-data-end