Feature: Add two numbers
  I as a user want to add two numbers to see the result

Scenario: Add two numbers manual
    Given open the calculator
    When I add 4 and 8
    Then the result should be 12

Scenario: Add two number manual failed
    Given open the calculator
    When I add 4 and 8
    Then the result should be 32