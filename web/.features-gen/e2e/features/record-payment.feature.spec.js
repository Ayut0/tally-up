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

});

// == technical section ==

test.use({
  $test: [({}, use) => use(test), { scope: 'test', box: true }],
  $uri: [({}, use) => use('e2e/features/record-payment.feature'), { scope: 'test', box: true }],
  $bddFileData: [({}, use) => use(bddFileData), { scope: "test", box: true }],
});

const bddFileData = [ // bdd-data-start
  {"pwTestLine":6,"pickleLine":13,"tags":[],"steps":[{"pwStepLine":7,"gherkinStepLine":14,"keywordType":"Context","textWithKeyword":"Given a group named \"Kyoto trip\" with members:","stepMatchArguments":[{"group":{"start":14,"value":"\"Kyoto trip\"","children":[{"start":15,"value":"Kyoto trip","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":8,"gherkinStepLine":18,"keywordType":"Action","textWithKeyword":"When Yuto adds an expense of ¥2000 for \"dinner\" split equally","stepMatchArguments":[{"group":{"start":0,"value":"Yuto"},"parameterTypeName":"word"},{"group":{"start":25,"value":"2000"},"parameterTypeName":"int"},{"group":{"start":34,"value":"\"dinner\"","children":[{"start":35,"value":"dinner","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":9,"gherkinStepLine":19,"keywordType":"Action","textWithKeyword":"And someone views the settle plan","stepMatchArguments":[]},{"pwStepLine":10,"gherkinStepLine":20,"keywordType":"Outcome","textWithKeyword":"Then the settle plan proposes:","stepMatchArguments":[]},{"pwStepLine":11,"gherkinStepLine":26,"keywordType":"Action","textWithKeyword":"When Aoi asks to pay Yuto a different amount","stepMatchArguments":[{"group":{"start":0,"value":"Aoi"},"parameterTypeName":"word"},{"group":{"start":16,"value":"Yuto"},"parameterTypeName":"word"}]},{"pwStepLine":12,"gherkinStepLine":29,"keywordType":"Outcome","textWithKeyword":"Then the payment form is prefilled with payer Aoi and counterparty Yuto","stepMatchArguments":[{"group":{"start":41,"value":"Aoi"},"parameterTypeName":"word"},{"group":{"start":62,"value":"Yuto"},"parameterTypeName":"word"}]},{"pwStepLine":13,"gherkinStepLine":30,"keywordType":"Action","textWithKeyword":"When Aoi pays Yuto ¥600 with memo \"cash tonight\"","stepMatchArguments":[{"group":{"start":0,"value":"Aoi"},"parameterTypeName":"word"},{"group":{"start":9,"value":"Yuto"},"parameterTypeName":"word"},{"group":{"start":15,"value":"600"},"parameterTypeName":"int"},{"group":{"start":29,"value":"\"cash tonight\"","children":[{"start":30,"value":"cash tonight","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":14,"gherkinStepLine":34,"keywordType":"Outcome","textWithKeyword":"Then the balances are:","stepMatchArguments":[]},{"pwStepLine":15,"gherkinStepLine":38,"keywordType":"Action","textWithKeyword":"When someone views the settle plan","stepMatchArguments":[]},{"pwStepLine":16,"gherkinStepLine":42,"keywordType":"Outcome","textWithKeyword":"Then the settle plan proposes:","stepMatchArguments":[]},{"pwStepLine":17,"gherkinStepLine":45,"keywordType":"Action","textWithKeyword":"When someone returns to the group","stepMatchArguments":[]},{"pwStepLine":18,"gherkinStepLine":46,"keywordType":"Action","textWithKeyword":"And the history shows \"cash tonight\" paid by Aoi","stepMatchArguments":[{"group":{"start":18,"value":"\"cash tonight\"","children":[{"start":19,"value":"cash tonight","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"},{"group":{"start":41,"value":"Aoi"},"parameterTypeName":"word"}]}]},
]; // bdd-data-end