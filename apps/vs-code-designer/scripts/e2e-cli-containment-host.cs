using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class E2eCliContainmentHost
{
    private const uint CREATE_SUSPENDED = 0x00000004;
    private const uint STARTF_USESTDHANDLES = 0x00000100;
    private const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
    private const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x00001000;
    private const int JobObjectBasicAccountingInformation = 1;
    private const int JobObjectBasicProcessIdList = 3;
    private const int JobObjectExtendedLimitInformation = 9;
    private const int CONTAINMENT_DRAIN_ATTEMPTS = 100;
    private const int CONTAINMENT_DRAIN_DELAY_MS = 100;
    private const uint INFINITE = 0xffffffff;

    [StructLayout(LayoutKind.Sequential)]
    private struct SECURITY_ATTRIBUTES
    {
        public int nLength;
        public IntPtr lpSecurityDescriptor;
        public int bInheritHandle;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct STARTUPINFO
    {
        public int cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public uint dwX;
        public uint dwY;
        public uint dwXSize;
        public uint dwYSize;
        public uint dwXCountChars;
        public uint dwYCountChars;
        public uint dwFillAttribute;
        public uint dwFlags;
        public short wShowWindow;
        public short cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput;
        public IntPtr hStdOutput;
        public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PROCESS_INFORMATION
    {
        public IntPtr hProcess;
        public IntPtr hThread;
        public uint dwProcessId;
        public uint dwThreadId;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IO_COUNTERS
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_BASIC_ACCOUNTING_INFORMATION
    {
        public long TotalUserTime;
        public long TotalKernelTime;
        public long ThisPeriodTotalUserTime;
        public long ThisPeriodTotalKernelTime;
        public uint TotalPageFaultCount;
        public uint TotalProcesses;
        public uint ActiveProcesses;
        public uint TotalTerminatedProcesses;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PROCESS_BASIC_INFORMATION
    {
        public IntPtr Reserved1;
        public IntPtr PebBaseAddress;
        public IntPtr Reserved2_0;
        public IntPtr Reserved2_1;
        public IntPtr UniqueProcessId;
        public IntPtr InheritedFromUniqueProcessId;
    }

    private struct RESIDUAL_PROCESS_INFORMATION
    {
        public uint ProcessId;
        public uint ParentProcessId;
        public uint SessionId;
        public string Name;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateProcess(
        string lpApplicationName,
        string lpCommandLine,
        ref SECURITY_ATTRIBUTES lpProcessAttributes,
        ref SECURITY_ATTRIBUTES lpThreadAttributes,
        bool bInheritHandles,
        uint dwCreationFlags,
        IntPtr lpEnvironment,
        string lpCurrentDirectory,
        ref STARTUPINFO lpStartupInfo,
        out PROCESS_INFORMATION lpProcessInformation);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr CreateJobObject(IntPtr lpJobAttributes, string lpName);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetInformationJobObject(IntPtr hJob, int infoClass, IntPtr lpInfo, uint cbInfo);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AssignProcessToJobObject(IntPtr hJob, IntPtr hProcess);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint ResumeThread(IntPtr hThread);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint WaitForSingleObject(IntPtr hHandle, uint milliseconds);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetExitCodeProcess(IntPtr hProcess, out uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool QueryInformationJobObject(IntPtr hJob, int infoClass, IntPtr lpInfo, uint cbInfo, out uint returnLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool TerminateJobObject(IntPtr hJob, uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool TerminateProcess(IntPtr hProcess, uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint dwDesiredAccess, bool bInheritHandle, uint dwProcessId);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool QueryFullProcessImageName(IntPtr hProcess, uint dwFlags, StringBuilder lpExeName, ref uint lpdwSize);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool ProcessIdToSessionId(uint dwProcessId, out uint pSessionId);

    [DllImport("ntdll.dll")]
    private static extern int NtQueryInformationProcess(
        IntPtr processHandle,
        int processInformationClass,
        ref PROCESS_BASIC_INFORMATION processInformation,
        uint processInformationLength,
        out uint returnLength);

    [DllImport("kernel32.dll")]
    private static extern IntPtr GetStdHandle(int nStdHandle);

    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr hObject);

    private static string Quote(string value)
    {
        if (value.Length > 0 && value.IndexOfAny(new[] { ' ', '\t', '\n', '\v', '"' }) < 0)
        {
            return value;
        }
        var result = new StringBuilder("\"");
        var backslashes = 0;
        foreach (var character in value)
        {
            if (character == '\\')
            {
                backslashes++;
                continue;
            }
            if (character == '"')
            {
                result.Append('\\', backslashes * 2 + 1);
                result.Append('"');
                backslashes = 0;
                continue;
            }
            result.Append('\\', backslashes);
            backslashes = 0;
            result.Append(character);
        }
        result.Append('\\', backslashes * 2);
        result.Append('"');
        return result.ToString();
    }

    private static uint ActiveProcesses(IntPtr job)
    {
        var size = Marshal.SizeOf(typeof(JOBOBJECT_BASIC_ACCOUNTING_INFORMATION));
        var pointer = Marshal.AllocHGlobal(size);
        try
        {
            uint returned;
            if (!QueryInformationJobObject(job, JobObjectBasicAccountingInformation, pointer, (uint)size, out returned))
            {
                throw new InvalidOperationException("QueryInformationJobObject failed: " + Marshal.GetLastWin32Error());
            }
            return ((JOBOBJECT_BASIC_ACCOUNTING_INFORMATION)Marshal.PtrToStructure(
                pointer,
                typeof(JOBOBJECT_BASIC_ACCOUNTING_INFORMATION))).ActiveProcesses;
        }
        finally
        {
            Marshal.FreeHGlobal(pointer);
        }
    }

    private static List<uint> ActiveProcessIds(IntPtr job)
    {
        const int capacity = 4096;
        var size = 8 + capacity * IntPtr.Size;
        var pointer = Marshal.AllocHGlobal(size);
        try
        {
            uint returned;
            if (!QueryInformationJobObject(job, JobObjectBasicProcessIdList, pointer, (uint)size, out returned))
            {
                throw new InvalidOperationException("QueryInformationJobObject process list failed: " + Marshal.GetLastWin32Error());
            }
            var count = Marshal.ReadInt32(pointer, 4);
            var processIds = new List<uint>(Math.Min(count, capacity));
            for (var index = 0; index < count && index < capacity; index++)
            {
                processIds.Add(unchecked((uint)Marshal.ReadIntPtr(pointer, 8 + index * IntPtr.Size).ToInt64()));
            }
            return processIds;
        }
        finally
        {
            Marshal.FreeHGlobal(pointer);
        }
    }

    private static RESIDUAL_PROCESS_INFORMATION ResidualProcessInformation(uint processId)
    {
        var information = new RESIDUAL_PROCESS_INFORMATION
        {
            ProcessId = processId,
            Name = "unavailable",
        };
        var processHandle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, processId);
        if (processHandle == IntPtr.Zero)
        {
            return information;
        }
        try
        {
            uint sessionId;
            if (ProcessIdToSessionId(processId, out sessionId))
            {
                information.SessionId = sessionId;
            }
            var basic = new PROCESS_BASIC_INFORMATION();
            uint returned;
            if (NtQueryInformationProcess(
                processHandle,
                0,
                ref basic,
                (uint)Marshal.SizeOf(typeof(PROCESS_BASIC_INFORMATION)),
                out returned) == 0)
            {
                information.ParentProcessId = unchecked((uint)basic.InheritedFromUniqueProcessId.ToInt64());
            }
            var executable = new StringBuilder(1024);
            var executableLength = (uint)executable.Capacity;
            if (QueryFullProcessImageName(processHandle, 0, executable, ref executableLength))
            {
                information.Name = Path.GetFileName(executable.ToString());
            }
            return information;
        }
        finally
        {
            CloseHandle(processHandle);
        }
    }

    private static List<RESIDUAL_PROCESS_INFORMATION> ResidualProcesses(IntPtr job)
    {
        var residuals = new List<RESIDUAL_PROCESS_INFORMATION>();
        try
        {
            foreach (var processId in ActiveProcessIds(job))
            {
                var information = ResidualProcessInformation(processId);
                residuals.Add(information);
                Console.Error.WriteLine(
                    "[containment] residual pid={0} ppid={1} session={2} name={3}",
                    information.ProcessId,
                    information.ParentProcessId,
                    information.SessionId,
                    information.Name);
            }
        }
        catch (Exception error)
        {
            Console.Error.WriteLine("[containment] residual metadata unavailable: {0}", error.Message);
        }
        return residuals;
    }

    private static string JsonString(string value)
    {
        return "\"" + value.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";
    }

    private static void WriteReceipt(
        string path,
        uint rootPid,
        uint rootExitCode,
        uint activeProcesses,
        IList<RESIDUAL_PROCESS_INFORMATION> residualProcesses)
    {
        var empty = activeProcesses == 0 ? "true" : "false";
        var residualJson = new StringBuilder("[");
        for (var index = 0; index < residualProcesses.Count; index++)
        {
            var residual = residualProcesses[index];
            if (index > 0)
            {
                residualJson.Append(',');
            }
            residualJson.Append("{\"pid\":").Append(residual.ProcessId)
                .Append(",\"parentPid\":").Append(residual.ParentProcessId)
                .Append(",\"sessionId\":").Append(residual.SessionId)
                .Append(",\"name\":").Append(JsonString(residual.Name))
                .Append('}');
        }
        residualJson.Append(']');
        File.WriteAllText(
            path,
            "{\"schemaVersion\":1,\"mechanism\":\"windows-job-object\",\"containmentEstablished\":true," +
            "\"rootPid\":" + rootPid + ",\"rootExitCode\":" + rootExitCode + ",\"rootSignal\":null," +
            "\"containmentEmpty\":" + empty + ",\"retainedOriginalIdentitiesVerified\":" + empty + "," +
            "\"escapedDescendants\":[],\"activeContainedProcessCount\":" + activeProcesses + "," +
            "\"activeContainedProcesses\":" + residualJson + "}\n");
    }

    public static int Main(string[] args)
    {
        if (args.Length < 2)
        {
            return 126;
        }
        var receiptPath = args[0];
        var executable = args[1];
        var commandLine = new StringBuilder(Quote(executable));
        for (var index = 2; index < args.Length; index++)
        {
            commandLine.Append(' ').Append(Quote(args[index]));
        }

        var job = CreateJobObject(IntPtr.Zero, null);
        if (job == IntPtr.Zero)
        {
            return 126;
        }
        var process = new PROCESS_INFORMATION();
        try
        {
            var limits = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            var limitsSize = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
            var limitsPointer = Marshal.AllocHGlobal(limitsSize);
            try
            {
                Marshal.StructureToPtr(limits, limitsPointer, false);
                if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, limitsPointer, (uint)limitsSize))
                {
                    return 126;
                }
            }
            finally
            {
                Marshal.FreeHGlobal(limitsPointer);
            }

            var processAttributes = new SECURITY_ATTRIBUTES { nLength = Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES)) };
            var threadAttributes = new SECURITY_ATTRIBUTES { nLength = Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES)) };
            var startup = new STARTUPINFO
            {
                cb = Marshal.SizeOf(typeof(STARTUPINFO)),
                dwFlags = STARTF_USESTDHANDLES,
                hStdInput = GetStdHandle(-10),
                hStdOutput = GetStdHandle(-11),
                hStdError = GetStdHandle(-12),
            };
            if (!CreateProcess(
                executable,
                commandLine.ToString(),
                ref processAttributes,
                ref threadAttributes,
                true,
                CREATE_SUSPENDED,
                IntPtr.Zero,
                null,
                ref startup,
                out process))
            {
                return 126;
            }
            if (!AssignProcessToJobObject(job, process.hProcess))
            {
                TerminateProcess(process.hProcess, 126);
                WaitForSingleObject(process.hProcess, INFINITE);
                return 126;
            }
            if (ResumeThread(process.hThread) == 0xffffffff)
            {
                return 126;
            }
            WaitForSingleObject(process.hProcess, INFINITE);
            uint rootExitCode;
            if (!GetExitCodeProcess(process.hProcess, out rootExitCode))
            {
                return 126;
            }

            uint active = ActiveProcesses(job);
            for (var attempt = 0; attempt < CONTAINMENT_DRAIN_ATTEMPTS && active > 0; attempt++)
            {
                Thread.Sleep(CONTAINMENT_DRAIN_DELAY_MS);
                active = ActiveProcesses(job);
            }
            var residualProcesses = active > 0 ? ResidualProcesses(job) : new List<RESIDUAL_PROCESS_INFORMATION>();
            WriteReceipt(receiptPath, process.dwProcessId, rootExitCode, active, residualProcesses);
            if (active > 0)
            {
                TerminateJobObject(job, 125);
                return 125;
            }
            return unchecked((int)rootExitCode);
        }
        finally
        {
            if (process.hThread != IntPtr.Zero) CloseHandle(process.hThread);
            if (process.hProcess != IntPtr.Zero) CloseHandle(process.hProcess);
            CloseHandle(job);
        }
    }
}
