// Maintainer smoke check for the reusable configs, not a target app's gate.
// Supply JAVA_HOME, DETEKT_JAR (1.23.8 all.jar), ANDROID_LINT (SDK CLI),
// and ANDROID_JAR (an installed SDK platform's android.jar).
// Uses temporary fixtures and does not install tools or change their configs.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
for (const name of ['JAVA_HOME', 'DETEKT_JAR', 'ANDROID_LINT', 'ANDROID_JAR']) {
  assert.ok(process.env[name], `Set ${name} to an installed tool before running this check.`)
}
const java = join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
const javac = join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'javac.exe' : 'javac')
assert.ok(existsSync(join(process.env.JAVA_HOME, 'lib/modules')),
  'JAVA_HOME must be the JDK home containing lib/modules, not a package-manager prefix.')
const detektJar = process.env.DETEKT_JAR
const lint = process.env.ANDROID_LINT
const platform = dirname(process.env.ANDROID_JAR)
const sdk = dirname(dirname(platform))
const sdkProperties = readFileSync(join(platform, 'source.properties'), 'utf8')
const api = sdkProperties.match(/^AndroidVersion.ApiLevel\s*=\s*(\d+(?:\.\d+)?)\s*$/m)?.[1]
assert.ok(api, 'ANDROID_JAR must belong to an installed Android SDK platform.')
const scratch = mkdtempSync(join(tmpdir(), 'android-baseline-'))

function run(command, args) {
  const env = { ...process.env }
  if (command === lint) {
    // Lint's API cache uses the JVM home property, not ANDROID_USER_HOME.
    // Keep its cache and metrics settings inside this check's temporary tree.
    env.JAVA_TOOL_OPTIONS = `-Duser.home="${scratch}"`
  }
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024,
    cwd: scratch,
    env,
  })
  assert.ifError(result.error)
  const output = result.stdout + result.stderr
  assert.notEqual(result.status, null, `Process terminated without an exit code: ${output}`)
  return { status: result.status, output }
}

function write(relative, content) {
  const path = join(scratch, relative)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
  return path
}

function detekt(relative, source) {
  return run(java, ['-jar', detektJar,
    '--config', join(root, 'config/detekt-1.23.yml'),
    '--classpath', detektJar,
    '--jdk-home', process.env.JAVA_HOME,
    '--jvm-target', '17',
    '--input', write(relative, source),
  ])
}

const manifest = `<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="baseline.fixture">
    <uses-sdk android:minSdkVersion="21" android:targetSdkVersion="35" />
    <application />
</manifest>`

function lintProject(name, source, layout = '') {
  write(`${name}/AndroidManifest.xml`, manifest)
  const annotation = write(`${name}/src/androidx/annotation/CheckResult.java`, `package androidx.annotation;
public @interface CheckResult {}`)
  const example = write(`${name}/src/baseline/fixture/Example.java`, source)
  const classes = join(scratch, name, 'bin/classes')
  mkdirSync(classes, { recursive: true })
  const compiled = run(javac, ['-classpath', process.env.ANDROID_JAR, '-d', classes, annotation, example])
  assert.equal(compiled.status, 0, compiled.output)
  if (layout) write(`${name}/res/layout/main.xml`, layout)
  const report = join(scratch, `${name}.xml`)
  // Limit only these artificial fixtures, not the target project's lint run.
  const result = run(lint, ['--offline', '--quiet', '--exitcode',
    '--config', join(root, 'config/lint.xml'),
    '--classpath', classes, '--sdk-home', sdk, '--compile-sdk-version', api,
    '--check', 'NewApi,MissingPermission,CheckResult,Recycle,StaticFieldLeak,WrongThread,ContentDescription,HardcodedText',
    '--xml', report, join(scratch, name),
  ])
  const xml = readFileSync(report, 'utf8')
  assert.doesNotMatch(xml, /id="LintError"/, xml)
  return { ...result, report: xml }
}

try {
  const version = run(java, ['-jar', detektJar, '--version'])
  assert.equal(version.status, 0, version.output)
  assert.equal(version.output.trim(), '1.23.8', 'This profile is validated against Detekt 1.23.8.')

  const bad = detekt('bad/Example.kt', `package baseline.fixture
import kotlinx.coroutines.GlobalScope
import kotlinx.coroutines.launch
fun unowned() { GlobalScope.launch {} }
suspend fun load(): String = "value"
suspend fun swallowed() = runCatching { load() }
suspend fun blocking() { Thread.sleep(1) }
fun unsafe(value: String?): String = value!!
fun cast(value: Any?): String = value as String
fun unfinished(): String = TODO("Implement this")
fun caught() { try { error("failure") } catch (failure: IllegalStateException) {} }
fun masked(): Int { try { return 1 } finally { return 2 } }
fun thrown() { try { loadSync() } finally { throw IllegalStateException("masked") } }
fun loadSync() = Unit
class BrokenEquality { override fun equals(other: Any?): Boolean = other is BrokenEquality }
fun ignoredSequence() { sequenceOf(1).map { it + 1 } }
fun unreachable(): String { return "value"; println("unreachable") }
`)
  assert.equal(bad.status, 2, bad.output)
  for (const rule of ['GlobalCoroutineUsage', 'SuspendFunSwallowedCancellation', 'SleepInsteadOfDelay',
    'UnsafeCallOnNullableType', 'CastNullableToNonNullableType',
    'NotImplementedDeclaration', 'EmptyCatchBlock', 'ReturnFromFinally',
    'ThrowingExceptionFromFinally', 'EqualsWithHashCodeExist', 'IgnoredReturnValue', 'UnreachableCode']) {
    assert.ok(bad.output.includes(`[${rule}]`), `Expected ${rule}:\n${bad.output}`)
  }

  const good = detekt('good/Example.kt', `package baseline.fixture
import java.io.IOException
import java.util.concurrent.CancellationException
suspend fun load(): String = "value"
suspend fun handled(): Result<String> = try {
    Result.success(load())
} catch (cancelled: CancellationException) {
    throw cancelled
} catch (failure: IOException) {
    Result.failure(failure)
}
fun validated(value: String?): String = requireNotNull(value)
// Naming and formatting choices are deliberately outside this profile.
fun Widget() = "rendered"
`)
  assert.equal(good.status, 0, good.output)
  console.log('Detekt 1.23.8: bad fixture fails with all 12 selected rules; corrected fixture passes.')

  const lintBad = lintProject('lint-bad', `package baseline.fixture;
import android.content.Context;
import android.content.res.TypedArray;
import android.location.Location;
import android.location.LocationManager;
import androidx.annotation.CheckResult;
public class Example {
    @CheckResult public static String token() { return "value"; }
    public static void ignored() { token(); }
    public static void leaked(Context context) {
        int color = context.getColor(android.R.color.black);
        TypedArray array = context.obtainStyledAttributes(new int[0]);
    }
    public static void api() { new android.app.NotificationChannel("id", "channel", 3); }
    public static Location location(LocationManager manager) {
        return manager.getLastKnownLocation("gps");
    }
}`)
  assert.equal(lintBad.status, 1, lintBad.output)
  for (const id of ['NewApi', 'MissingPermission', 'CheckResult', 'Recycle']) {
    assert.match(lintBad.report, new RegExp(`id="${id}"\\s+severity="Error"`), lintBad.output + lintBad.report)
  }

  const safeJava = `package baseline.fixture;
import android.content.Context;
import android.content.res.TypedArray;
import androidx.annotation.CheckResult;
public class Example {
    @CheckResult public static String token() { return "value"; }
    public static String used() { return token(); }
    public static void released(Context context) {
        TypedArray array = context.obtainStyledAttributes(new int[0]);
        try { array.getIndexCount(); } finally { array.recycle(); }
    }
}`
  const lintGood = lintProject('lint-good', safeJava)
  assert.equal(lintGood.status, 0, lintGood.output)
  assert.doesNotMatch(lintGood.report, /<issue\b/, lintGood.report)

  const warning = lintProject('lint-warning', safeJava,
    `<TextView xmlns:android="http://schemas.android.com/apk/res/android"
      android:layout_width="wrap_content" android:layout_height="wrap_content"
      android:text="Label" />`)
  assert.equal(warning.status, 0, warning.output)
  assert.match(warning.report, /id="HardcodedText"\s+severity="Warning"/, warning.report)
  console.log('Android Lint: four error checks fail; corrected fixture passes; advisory warning stays nonblocking.')
  const lintVersion = run(lint, ['--version'])
  assert.equal(lintVersion.status, 0, lintVersion.output)
  const versionLine = lintVersion.output.match(/^lint: version .+$/m)
  assert.ok(versionLine, lintVersion.output)
  console.log(versionLine[0])
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
