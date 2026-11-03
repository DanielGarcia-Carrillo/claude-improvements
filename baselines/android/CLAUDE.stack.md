<!--
Kotlin/Android fragment for an existing project's agent file. Merge applicable
sections; do not replace that file or invent Gradle commands. Establish project
ownership and follow baselines/README.md's ownership and adoption policy.
-->

## Baseline adoption

- In Daniel's projects, actively evaluate new baseline recommendations,
  including those that conflict with the current setup. Adopt useful changes
  judiciously, considering correctness, maintenance, compatibility, migration
  cost, and disruption. Record adoption, deferral, or rejection reasons.
- In other people's projects, their requirements and conventions take
  precedence. A personal fork contributing upstream follows upstream's rules.
- Keep explicit instructions and project review, validation, and release
  gates in force until deliberately revised through the normal process.
  Update configuration and instructions together for an adopted change.

## Commands

- Discover the actual verification command, modules, variants, and configured
  tools from the project's instructions and CI. Use its Gradle wrapper and
  build JDK. Record the exact commands here when integrating this fragment.
- Run Android Lint explicitly for relevant variants. Run the configured
  formatter, behavior tests, and required device or visual checks.
- If Detekt is adopted, include type-resolving checks with the compilation
  classpath. Do not claim a syntax-only run exercised typed rules.

## Kotlin and Android safety

- Blocking I/O and expensive work stay off the main thread. A `suspend`
  function does not automatically move work to a background thread.
- Give coroutines, listeners, and resources an owner and cleanup path.
  Preserve cancellation; broad catches and `runCatching` must not swallow it.
- Handle nullable input deliberately. Avoid `!!` and nullable-to-non-null
  casts; prefer explicit validation or a type that expresses the invariant.
- Keep a clear state owner and lifecycle-aware observation. A ViewModel
  survives configuration changes, not process death. Use existing state
  restoration and persistence mechanisms for relevant user input and data.
- Respect supported Android versions and permission-denial paths. Handle
  required return values and close or release resources.
- Merge selected rules from the Android baseline's lint and Detekt configs
  under the ownership policy. Retain other project checks and stronger
  settings; review narrowly scoped suppressions with their reasons.
- Add behavior tests for realistic success and failure cases. UI changes
  need the project's relevant device/emulator and visual evidence.

## Handoff

- Report the exact commit, commands and results, checked modules/variants,
  and relevant device API levels. Separate existing failures and unrun checks.
- Review lifecycle ownership, cancellation, restoration, and surrounding
  call sites. Apply the project's finding-severity policy.
- Record intentional baseline departures and tool/configuration changes.
  Do not expand suppression baselines or replace screenshots just to get green.
