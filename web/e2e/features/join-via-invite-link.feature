# Story 1/7 of #276. Proves the product's entire sharing model
# (docs/architecture.md §2: "no accounts, no installs, just a link" — the
# group URL *is* the capability, identity is "pick your name from the member
# list"). This is the one scenario that needs a second browser: the creator's
# own browser is always already identified (useCreateGroupForm), so only a
# phone that has never seen the group reaches the join picker.
Feature: A friend opens the invite link and picks who they are

  Scenario: A second phone joins by picking a name
    Given a group named "Kyoto trip" with members:
      | name |
      | Yuto |
      | Aoi  |
    When a second phone opens the invite link
    And picks Aoi
    Then the second phone lands on the group page
    When the second phone reopens the invite link
    Then the second phone is not asked again
