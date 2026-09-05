// Generated from: e2e/features/record-payment.feature
import { test } from "../../../e2e/steps/fixtures.ts";

test.describe('Recording a payment that isn\'t on the plan', () => {

  test('A partial payment leaves the remainder owed and on the plan', async ({ Given, When, Then, And, addExpense, group, home, recordPayment, settle }) => { 
    await Given('a group named "Kyoto trip" with members:', {"dataTable":{"rows":[{"cells":[{"value":"name"}]},{"cells":[{"value":"Yuto"}]},{"cells":[{"value":"Aoi"}]}]}}, { group, home }); 
    await When('Yuto adds an expense of ¥2000 for "dinner" split equally', null, { addExpense, group }); 
    await And('someone views the settle plan', null, { group }); 
    await Then('the settle plan proposes:', {"dataTable":{"rows":[{"cells":[{"value":"from"},{"value":"to"},{"value":"amount"}]},{"cells":[{"value":"Aoi"},{"value":"Yuto"},{"value":"¥1,000"}]}]}}, { settle }); 
    await When('Aoi asks to pay Yuto a different amount', null, { settle }); 
    await Then('the payment form is prefilled with payer Aoi and counterparty Yuto', null, { recordPayment }); 
    await When('Aoi pays Yuto ¥600 with memo "cash tonight"', null, { recordPayment }); 
    await Then('the balances are:', {"dataTable":{"rows":[{"cells":[{"value":"member"},{"value":"balance"}]},{"cells":[{"value":"Yuto"},{"value":"+¥400"}]},{"cells":[{"value":"Aoi"},{"value":"−¥400"}]}]}}, { group }); 
    await When('someone views the settle plan', null, { group }); 
    await Then('the settle plan proposes:', {"dataTable":{"rows":[{"cells":[{"value":"from"},{"value":"to"},{"value":"amount"}]},{"cells":[{"value":"Aoi"},{"value":"Yuto"},{"value":"¥400"}]}]}}, { settle }); 
    await When('someone returns to the group', null, { settle }); 
    await And('the history shows "cash tonight" paid by Aoi', null, { group }); 
  });

  test('Overpaying flips who owes whom', async ({ Given, When, Then, And, addExpense, group, home, recordPayment, settle }) => { 
    await Given('a group named "Kyoto trip" with members:', {"dataTable":{"rows":[{"cells":[{"value":"name"}]},{"cells":[{"value":"Yuto"}]},{"cells":[{"value":"Aoi"}]}]}}, { group, home }); 
    await When('Yuto adds an expense of ¥2000 for "dinner" split equally', null, { addExpense, group }); 
    await And('someone views the settle plan', null, { group }); 
    await Then('the settle plan proposes:', {"dataTable":{"rows":[{"cells":[{"value":"from"},{"value":"to"},{"value":"amount"}]},{"cells":[{"value":"Aoi"},{"value":"Yuto"},{"value":"¥1,000"}]}]}}, { settle }); 
    await When('Aoi asks to pay Yuto a different amount', null, { settle }); 
    await Then('the payment form is prefilled with payer Aoi and counterparty Yuto', null, { recordPayment }); 
    await When('Aoi pays Yuto ¥1500 with memo "rounding up"', null, { recordPayment }); 
    await Then('the balances are:', {"dataTable":{"rows":[{"cells":[{"value":"member"},{"value":"balance"}]},{"cells":[{"value":"Yuto"},{"value":"−¥500"}]},{"cells":[{"value":"Aoi"},{"value":"+¥500"}]}]}}, { group }); 
    await When('someone views the settle plan', null, { group }); 
    await Then('the settle plan proposes:', {"dataTable":{"rows":[{"cells":[{"value":"from"},{"value":"to"},{"value":"amount"}]},{"cells":[{"value":"Yuto"},{"value":"Aoi"},{"value":"¥500"}]}]}}, { settle }); 
  });

  test('A stale record-payment link shows an error, not a blank form', async ({ When, Then, recordPayment }) => { 
    await When('someone opens a broken record-payment link', null, { recordPayment }); 
    await Then('someone sees a "group not found" error', null, { recordPayment }); 
  });

});

// == technical section ==

test.use({
  $test: [({}, use) => use(test), { scope: 'test', box: true }],
  $uri: [({}, use) => use('e2e/features/record-payment.feature'), { scope: 'test', box: true }],
  $bddFileData: [({}, use) => use(bddFileData), { scope: "test", box: true }],
});

const bddFileData = [ // bdd-data-start
  {"pwTestLine":6,"pickleLine":13,"tags":[],"steps":[{"pwStepLine":7,"gherkinStepLine":14,"keywordType":"Context","textWithKeyword":"Given a group named \"Kyoto trip\" with members:","stepMatchArguments":[{"group":{"start":14,"value":"\"Kyoto trip\"","children":[{"start":15,"value":"Kyoto trip","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":8,"gherkinStepLine":18,"keywordType":"Action","textWithKeyword":"When Yuto adds an expense of ¥2000 for \"dinner\" split equally","stepMatchArguments":[{"group":{"start":0,"value":"Yuto"},"parameterTypeName":"word"},{"group":{"start":25,"value":"2000"},"parameterTypeName":"int"},{"group":{"start":34,"value":"\"dinner\"","children":[{"start":35,"value":"dinner","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":9,"gherkinStepLine":19,"keywordType":"Action","textWithKeyword":"And someone views the settle plan","stepMatchArguments":[]},{"pwStepLine":10,"gherkinStepLine":20,"keywordType":"Outcome","textWithKeyword":"Then the settle plan proposes:","stepMatchArguments":[]},{"pwStepLine":11,"gherkinStepLine":26,"keywordType":"Action","textWithKeyword":"When Aoi asks to pay Yuto a different amount","stepMatchArguments":[{"group":{"start":0,"value":"Aoi"},"parameterTypeName":"word"},{"group":{"start":16,"value":"Yuto"},"parameterTypeName":"word"}]},{"pwStepLine":12,"gherkinStepLine":29,"keywordType":"Outcome","textWithKeyword":"Then the payment form is prefilled with payer Aoi and counterparty Yuto","stepMatchArguments":[{"group":{"start":41,"value":"Aoi"},"parameterTypeName":"word"},{"group":{"start":62,"value":"Yuto"},"parameterTypeName":"word"}]},{"pwStepLine":13,"gherkinStepLine":30,"keywordType":"Action","textWithKeyword":"When Aoi pays Yuto ¥600 with memo \"cash tonight\"","stepMatchArguments":[{"group":{"start":0,"value":"Aoi"},"parameterTypeName":"word"},{"group":{"start":9,"value":"Yuto"},"parameterTypeName":"word"},{"group":{"start":15,"value":"600"},"parameterTypeName":"int"},{"group":{"start":29,"value":"\"cash tonight\"","children":[{"start":30,"value":"cash tonight","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":14,"gherkinStepLine":34,"keywordType":"Outcome","textWithKeyword":"Then the balances are:","stepMatchArguments":[]},{"pwStepLine":15,"gherkinStepLine":38,"keywordType":"Action","textWithKeyword":"When someone views the settle plan","stepMatchArguments":[]},{"pwStepLine":16,"gherkinStepLine":42,"keywordType":"Outcome","textWithKeyword":"Then the settle plan proposes:","stepMatchArguments":[]},{"pwStepLine":17,"gherkinStepLine":45,"keywordType":"Action","textWithKeyword":"When someone returns to the group","stepMatchArguments":[]},{"pwStepLine":18,"gherkinStepLine":46,"keywordType":"Action","textWithKeyword":"And the history shows \"cash tonight\" paid by Aoi","stepMatchArguments":[{"group":{"start":18,"value":"\"cash tonight\"","children":[{"start":19,"value":"cash tonight","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"},{"group":{"start":41,"value":"Aoi"},"parameterTypeName":"word"}]}]},
  {"pwTestLine":21,"pickleLine":48,"tags":[],"steps":[{"pwStepLine":22,"gherkinStepLine":49,"keywordType":"Context","textWithKeyword":"Given a group named \"Kyoto trip\" with members:","stepMatchArguments":[{"group":{"start":14,"value":"\"Kyoto trip\"","children":[{"start":15,"value":"Kyoto trip","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":23,"gherkinStepLine":53,"keywordType":"Action","textWithKeyword":"When Yuto adds an expense of ¥2000 for \"dinner\" split equally","stepMatchArguments":[{"group":{"start":0,"value":"Yuto"},"parameterTypeName":"word"},{"group":{"start":25,"value":"2000"},"parameterTypeName":"int"},{"group":{"start":34,"value":"\"dinner\"","children":[{"start":35,"value":"dinner","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":24,"gherkinStepLine":54,"keywordType":"Action","textWithKeyword":"And someone views the settle plan","stepMatchArguments":[]},{"pwStepLine":25,"gherkinStepLine":55,"keywordType":"Outcome","textWithKeyword":"Then the settle plan proposes:","stepMatchArguments":[]},{"pwStepLine":26,"gherkinStepLine":58,"keywordType":"Action","textWithKeyword":"When Aoi asks to pay Yuto a different amount","stepMatchArguments":[{"group":{"start":0,"value":"Aoi"},"parameterTypeName":"word"},{"group":{"start":16,"value":"Yuto"},"parameterTypeName":"word"}]},{"pwStepLine":27,"gherkinStepLine":59,"keywordType":"Outcome","textWithKeyword":"Then the payment form is prefilled with payer Aoi and counterparty Yuto","stepMatchArguments":[{"group":{"start":41,"value":"Aoi"},"parameterTypeName":"word"},{"group":{"start":62,"value":"Yuto"},"parameterTypeName":"word"}]},{"pwStepLine":28,"gherkinStepLine":64,"keywordType":"Action","textWithKeyword":"When Aoi pays Yuto ¥1500 with memo \"rounding up\"","stepMatchArguments":[{"group":{"start":0,"value":"Aoi"},"parameterTypeName":"word"},{"group":{"start":9,"value":"Yuto"},"parameterTypeName":"word"},{"group":{"start":15,"value":"1500"},"parameterTypeName":"int"},{"group":{"start":30,"value":"\"rounding up\"","children":[{"start":31,"value":"rounding up","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":29,"gherkinStepLine":65,"keywordType":"Outcome","textWithKeyword":"Then the balances are:","stepMatchArguments":[]},{"pwStepLine":30,"gherkinStepLine":69,"keywordType":"Action","textWithKeyword":"When someone views the settle plan","stepMatchArguments":[]},{"pwStepLine":31,"gherkinStepLine":73,"keywordType":"Outcome","textWithKeyword":"Then the settle plan proposes:","stepMatchArguments":[]}]},
  {"pwTestLine":34,"pickleLine":77,"tags":[],"steps":[{"pwStepLine":35,"gherkinStepLine":82,"keywordType":"Action","textWithKeyword":"When someone opens a broken record-payment link","stepMatchArguments":[]},{"pwStepLine":36,"gherkinStepLine":83,"keywordType":"Outcome","textWithKeyword":"Then someone sees a \"group not found\" error","stepMatchArguments":[{"group":{"start":15,"value":"\"group not found\"","children":[{"start":16,"value":"group not found","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]}]},
]; // bdd-data-end