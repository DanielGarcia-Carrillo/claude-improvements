# Kotlin/Android contribution quality

For changes to existing Kotlin Android projects, including contributions by
developers and agents without deep Android experience. The aim is to catch
common defects with the repository's checks, behavior tests, and focused
review. Google's Android architecture recommendations are the main
engineering reference, supported by its coroutine and core app quality
guidance. This is a contribution guide with no scaffold or pinned toolchain.

**The target repository's requirements and guidelines take precedence.**
Follow the [shared adoption guidance](../README.md#existing-repositories).
Apply relevant checks to the changed feature and surrounding code. A
Fragment/XML app keeps its established patterns; a Compose app uses its
existing state, navigation, and dependency conventions. These recommendations
do not authorize a framework migration, new dependencies, or a repo-wide
cleanup outside the assigned scope.

Sources and tooling status were checked on 2026-11-03. Check compatibility
again before adding a tool; this guide has not validated a runnable Android
project or a particular combination of plugin versions.

## Using it in an existing repository

1. Read applicable agent files, contributor instructions, accepted decisions,
   and the feature's requirements. Inspect the Gradle wrapper, version
   catalog if present, plugins, lint configuration, tests, and CI. Identify
   the supported Android versions, build variants, and handoff commands.
2. Run the existing relevant checks before changing behavior when practical.
   Record pre-existing failures. Use the repository's wrapper and configured
   JDK; keep the IDE, terminal, and CI build environments consistent.
3. Assess the checks below as already covered, a relevant gap, a conflict,
   or not applicable. Record proposed additions with the defect they would
   catch. Implement them only within the authorized scope and repository
   process. Preserve conflicting repository requirements and explain the
   tradeoff.
4. Make the contribution using existing patterns. Add tests for observable
   behavior and realistic failure cases, then run the required gate and the
   relevant Android checks. Inspect surrounding call sites, ownership, and
   data flow as well as the diff.
5. Hand off the exact commit, commands, results, and behavior evidence. Name
   checks that could not run and what confidence is missing. Keep existing
   failures distinct from failures introduced by the contribution.

## Review checklist

Use the relevant rows for each contribution. This is a review aid; evidence
and the repository's severity policy determine finding disposition.

| Area | What to check | Evidence to look for |
|---|---|---|
| Repository fit | Existing architecture, dependency wiring, naming, formatting, and supported variants are respected. Reuse established services and helpers. | Applicable instructions and nearby implementations; no unrelated tool or framework changes |
| Kotlin types | Handle nullable inputs deliberately; avoid unnecessary `!!`, unchecked casts, and leaking mutable state. Represent mutually exclusive states explicitly when that improves correctness. | Malformed or absent input tests; public state cannot be changed through a mutable alias |
| Lifecycle and ownership | Coroutines, observers, listeners, and resources have appropriate owners and cleanup. Longer-lived objects do not retain destroyed screens. | Leaving and reopening the screen; cancellation and cleanup paths; ownership of callbacks and subscriptions |
| Threading and cancellation | Blocking I/O and expensive work stay off the main thread. A `suspend` function is not automatically nonblocking. Cancellation propagates; `runCatching` or broad catches do not turn it into an ordinary error. | Dispatcher usage and coroutine scope; deterministic coroutine tests; cancellation behavior |
| UI state | State has a clear owner. Observe it with the repository's lifecycle-aware mechanism. Distinguish local UI state, restorable transient state, and durable user data. | Rotation, background/return, and relevant system-initiated process restoration; a ViewModel alone does not survive process death |
| Data and failures | Follow existing repository/data-source boundaries. Handle relevant empty, loading, offline, and failure states. Persist user data and migrate schemas using the project's mechanisms. | Success and failure tests, retry behavior, migration tests when schemas change |
| Platform compatibility | Respect minimum Android versions, runtime permissions, background restrictions, and navigation behavior. Handle denied permissions where relevant. | Lint results and behavior on relevant supported API levels; Back and permission-denial checks |
| Privacy and security | Minimize permissions and sensitive logging. Preserve the project's authentication, storage, backup, and component-exposure rules. | Review affected manifest entries and data boundaries; no secrets in source or diagnostic output |
| UI and accessibility | Check relevant layouts, semantics, touch interactions, themes, and text scaling using existing design and localization conventions. | Device/emulator interaction, representative screenshots, and existing accessibility or visual checks |
| Tests | Test changed behavior through observable results, including realistic edge cases. Prefer existing fixtures and fakes; control asynchronous execution rather than waiting arbitrary durations. | A regression test reproduces the bug when practical; tests fail for the behavior they protect |

For Compose, also inspect state remembering, effect keys and lifetimes, and
modifier forwarding. For Views/Fragments, inspect view lifecycle ownership
of observers and bindings. Keep any recommendations that depend on a
different architecture as proposals, rather than treating the current
architecture as a defect.

## Automated checks

Reuse configured tools first. If a check is missing, propose the smallest
compatible addition that catches a concrete defect class. Tool adoption
does not justify upgrading the app's toolchain or changing its formatter
as an incidental part of a feature.

| Check | Role | Integration guidance |
|---|---|---|
| Existing gate | Preserve the repository's required validation. | Discover the actual commands and variant coverage; keep local and CI behavior consistent. |
| Android Lint | Android correctness, API compatibility, security, accessibility, and performance diagnostics. | Run explicitly for relevant modules and variants. A successful build alone does not run the full lint checks. Preserve configured severities and explain narrow exceptions. |
| Existing formatter | Consistent Kotlin and build-script formatting. | Keep the configured formatter and style. ktlint, ktfmt, and Spotless are possibilities when filling a gap; select one formatting path for a given file. |
| Detekt | Kotlin potential bugs, coroutine misuse, and relevant exception, complexity, or performance concerns. | Review selected rules, their defaults, and compatibility. Many coroutine checks need type resolution. Do not assume running the generic task covers those rules. |
| Compose Rules | Additional Compose checks for state, effects, and modifier handling. | Only for Compose code, using a ruleset compatible with the existing Detekt or ktlint version. Review naming and other convention rules against the repository's choices. |
| Existing test tools | Behavior, regression, device interaction, and visual checks. | Extend the existing JUnit, coroutine, Compose, Espresso, or screenshot setup as appropriate; keep device tests distinct from JVM-only results. |

Useful Detekt candidates include `GlobalCoroutineUsage`,
`SleepInsteadOfDelay`, and `SuspendFunSwallowedCancellation` where available
in the selected version. Check each rule's activation and type-resolution
requirements. For example, the cancellation rule is disabled by default in
the checked documentation and requires type resolution. Configure Compose
exceptions deliberately so naming, preview functions, and default-heavy
parameter lists do not produce distracting findings.

As of the check date, Detekt's latest stable release is 1.23.8 and its
2.0 line is Alpha. Consult its compatibility table and validate the chosen
setup before requiring it. This is a reason to check a proposed addition,
not a reason to replace a working repository configuration.

## Introducing checks without hiding defects

The contribution guide is a quality baseline. Lint and Detekt also use the
word "baseline" for files that suppress known existing findings. Those files
are an incremental adoption mechanism, not evidence that the findings are
harmless.

When introducing a check into a repository with existing findings:

1. Run it without a suppression baseline and review the results. Record
   the command, variant/source coverage, and existing debt separately from
   the contribution. Triage findings under the repository's severity policy.
2. If that policy allows deferring existing findings, capture only the
   accepted debt. Android Lint uses `lint-baseline.xml`; Detekt provides
   baseline-generation tasks and can use variant-specific baseline files.
3. Check the reviewed files into version control and enforce the adopted
   checks on subsequent work. New findings follow the repository's policy;
   do not regenerate or expand the baseline just to make a change pass.
4. Remove resolved entries with the tool's supported update process and
   review the diff. Keep baseline generation separate from routine verify
   so verification cannot silently accept new debt.

Likewise, preserve existing screenshot references and review visual changes
before accepting replacement images. A recorded image is an expectation,
not proof of correct behavior.

Android Baseline Profiles are a separate performance optimization feature.
They are not a code-quality score or a substitute for checks and tests.
Use the project's profiling and benchmark process when performance is part
of the contribution; adding profiles is not a prerequisite for an unrelated
code change.

## Evidence before handoff

Follow the repository's acceptance and review process. A useful handoff
records:

- the branch and exact commit, changed behavior, and relevant modules/variants;
- required commands and their results, including which checks actually ran;
- tests for the change and applicable error, lifecycle, or persistence paths;
- device/emulator API level and visual evidence for relevant UI changes;
- finding dispositions under the repository's severity policy, departures
  from its conventions, and any validation limitation.

Lint and tests supplement review. Ask the reviewer to check concrete Android
failure scenarios in the changed feature and its surrounding code, including
ownership, cancellation, state restoration, and supported-platform behavior.

## IDE

Android Studio's stable channel is the recommended default for native Android
work: it includes Android debugging, emulator integration, layout inspection,
and profiling tools. Keep any IDE version the repository requires. Its build
JDK should match the project's configuration for terminal and CI builds.
IDE inspections supplement the reproducible repository gate.

## Sources

- Google [Android architecture recommendations](https://developer.android.com/topic/architecture/recommendations):
  responsibilities, state, lifecycle awareness, dependency injection, and
  testing. Google explicitly presents these as recommendations to adapt.
- Google [coroutine best practices](https://developer.android.com/kotlin/coroutines/coroutines-best-practices):
  scopes, main-safe work, test dispatchers, and cancellation.
- Google [core app quality guidelines](https://developer.android.com/docs/quality-guidelines/core-app-quality):
  observable behavior, compatibility, permissions, and interruption tests.
- Google [saving UI state](https://developer.android.com/develop/ui/compose/state-saving):
  configuration changes, process death, and transient versus persistent state.
- [Kotlin coding conventions](https://kotlinlang.org/docs/coding-conventions.html)
  and Google's [Android Kotlin style guide](https://developer.android.com/kotlin/style-guide):
  secondary references where the repository has no established convention.
- [Android Lint](https://developer.android.com/studio/write/lint): explicit
  execution, variant coverage, and existing-finding baselines.
- Detekt [coroutine rules](https://detekt.dev/docs/rules/coroutines/),
  [Gradle tasks and baselines](https://detekt.dev/docs/gettingstarted/gradle/),
  [Compose configuration](https://detekt.dev/docs/introduction/compose/),
  [compatibility table](https://detekt.dev/docs/introduction/compatibility/),
  and [stable release](https://github.com/detekt/detekt/releases/tag/v1.23.8).
- [Compose Rules](https://mrmans0n.github.io/compose-rules/latest/rules/):
  optional checks for Compose-specific mistakes.
- Google [Android Studio overview](https://developer.android.com/studio/intro)
  and [build JDK configuration](https://developer.android.com/build/jdks).
- Google [Baseline Profiles overview](https://developer.android.com/topic/performance/baselineprofiles/overview):
  the separate performance optimization feature.
