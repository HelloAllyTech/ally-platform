// google-services (and Crashlytics) are applied by app/build.gradle.kts
// only when a google-services.json is present, so it goes on the classpath here (an
// `apply(plugin = ...)` by id needs it there), as RN's root build.gradle does.
buildscript {
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        classpath("com.google.gms:google-services:4.4.2")
        // RN's root build.gradle has firebase-crashlytics-gradle (2.9.9, for
        // AGP 8); 3.x is the line built for AGP 8.1+. Applied only alongside
        // google-services, see app/build.gradle.kts.
        classpath("com.google.firebase:firebase-crashlytics-gradle:3.0.6")
    }
}

allprojects {
    repositories {
        google()
        mavenCentral()
    }
}

val newBuildDir: Directory =
    rootProject.layout.buildDirectory
        .dir("../../build")
        .get()
rootProject.layout.buildDirectory.value(newBuildDir)

subprojects {
    val newSubprojectBuildDir: Directory = newBuildDir.dir(project.name)
    project.layout.buildDirectory.value(newSubprojectBuildDir)
}
subprojects {
    project.evaluationDependsOn(":app")
}

tasks.register<Delete>("clean") {
    delete(rootProject.layout.buildDirectory)
}
