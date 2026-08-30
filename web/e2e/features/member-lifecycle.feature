# Story 3/7 of #276. Membership isn't fixed at creation: a member added
# after expenses exist owes nothing for what they missed, and a member who
# still owes the group cannot leave — the 409 from DELETE /members/{id} is
# a server-side invariant surfaced through the client, proven here against
# the real API rather than an MSW handler built from the same mental model
# as the component (docs/architecture.md, ADR 0006).
Feature: Members joining and leaving mid-trip

  Scenario: A member who joins after expenses exist owes nothing for what they missed
    Given a group named "Kyoto trip" with members:
      | name |
      | Yuto |
      | Aoi  |
    When Yuto adds an expense of ¥2000 for "lunch" split equally
    And Ren joins the group
    Then the balances are:
      | member | balance |
      | Ren    | ¥0      |
    And Ren is available to split expenses with

  Scenario: A member with a nonzero balance cannot be removed
    Given a group named "Kyoto trip" with members:
      | name |
      | Yuto |
      | Aoi  |
    When Yuto adds an expense of ¥2000 for "lunch" split equally
    And Aoi tries to leave the group
    Then Aoi is refused: "member has a nonzero balance; settle up before removing"
    And Aoi is still a member of the group

  # The positive control: proves the refusal above isn't vacuous by showing
  # the same UI action succeeds once the balance is zero.
  Scenario: A member with a zero balance can be removed
    Given a group named "Kyoto trip" with members:
      | name |
      | Yuto |
      | Aoi  |
    When Aoi leaves the group
    Then Aoi is no longer a member of the group
